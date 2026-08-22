<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { emergencyStopState } from '$lib/emergency-stop-state';
	import { DEFAULT_CUT_FEED_RATE, clampCutFeedRate } from '$lib/cut-speed';
	import { DEFAULT_CUT_HEIGHT, clampCutHeight } from '$lib/cut-height';
	import {
		CUT_PROCESS_LIMITS,
		defaultCutProcessSettings,
		sanitizeCutProcessSettings,
		type CutProcessSettings
	} from '$lib/cut-process';
	import { machineApi } from '$lib/machine-api';
	import NumberPad from '$lib/NumberPad.svelte';

	const DXF_FEED_RATE_STORAGE_KEY = 'autocut-dxf-cut-feed-rate';
	const DXF_CUT_HEIGHT_STORAGE_KEY = 'autocut-dxf-cut-height';
	const DXF_CUT_PROCESS_STORAGE_KEY = 'autocut-dxf-cut-process';

	let fileInput: HTMLInputElement | null = null;
	let selectedFile: File | null = null;
	let previewLines: string[] = [];
	let uploadState: 'idle' | 'ready' | 'uploading' | 'uploaded' | 'error' = 'idle';
	let uploadMessage = 'Nog geen DXF geladen.';
	let uploadedPath = '';
	let lastError = '';
	let machineState = 'Connecting';
	let poll: ReturnType<typeof setInterval> | null = null;
	let stateRefreshInFlight = false;
	let cutProcess: CutProcessSettings = defaultCutProcessSettings;

	let padOpen = false;
	let padTitle = '';
	let padValue = '';
	let padCurrent = 0;
	let padMin = 0;
	let padMax = 0;
	let padUnit = '';
	let padError = '';
	let padKey: keyof CutProcessSettings | null = null;

	function fmtClean(value: number, decimals = 2) {
		const factor = 10 ** decimals;
		const rounded = Math.round(value * factor) / factor;
		return rounded.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
	}

	function loadCutProcess() {
		if (!browser) return;

		const legacyFeed = localStorage.getItem(DXF_FEED_RATE_STORAGE_KEY);
		const legacyHeight = localStorage.getItem(DXF_CUT_HEIGHT_STORAGE_KEY);
		const legacy: Partial<CutProcessSettings> = {
			straightFeedRate: legacyFeed === null ? DEFAULT_CUT_FEED_RATE : clampCutFeedRate(Number(legacyFeed), DEFAULT_CUT_FEED_RATE),
			curveFeedRate: legacyFeed === null ? defaultCutProcessSettings.curveFeedRate : clampCutFeedRate(Number(legacyFeed), DEFAULT_CUT_FEED_RATE),
			cutHeight: legacyHeight === null ? DEFAULT_CUT_HEIGHT : clampCutHeight(Number(legacyHeight), DEFAULT_CUT_HEIGHT)
		};

		try {
			const raw = localStorage.getItem(DXF_CUT_PROCESS_STORAGE_KEY);
			cutProcess = sanitizeCutProcessSettings(raw ? { ...legacy, ...JSON.parse(raw) } : legacy);
		} catch {
			cutProcess = sanitizeCutProcessSettings(legacy);
		}

		persistCutProcess();
	}

	function persistCutProcess() {
		if (!browser) return;
		localStorage.setItem(DXF_CUT_PROCESS_STORAGE_KEY, JSON.stringify(cutProcess));
	}

	function setCutProcessValue(key: keyof CutProcessSettings, value: number) {
		cutProcess = sanitizeCutProcessSettings({ ...cutProcess, [key]: value });
		persistCutProcess();
	}

	function openCutProcessPad(title: string, key: keyof CutProcessSettings, unit: string) {
		const limits = CUT_PROCESS_LIMITS[key];
		padTitle = title;
		padKey = key;
		padValue = '';
		padCurrent = cutProcess[key];
		padMin = limits.min;
		padMax = limits.max;
		padUnit = unit;
		padError = '';
		padOpen = true;
	}

	function closePad() {
		padOpen = false;
		padError = '';
		padKey = null;
	}

	function padAppend(ch: string) {
		if (ch === '.' && padValue.includes('.')) return;
		if (padValue === '' && ch === '.') {
			padValue = '0.';
			return;
		}
		padValue += ch;
	}

	function padBackspace() {
		padValue = padValue.slice(0, -1);
	}

	function padClear() {
		padValue = '';
	}

	function confirmPad() {
		if (!padKey) return;

		const raw = padValue.replace(',', '.').trim();
		if (!raw) {
			padError = 'Voer eerst een waarde in.';
			return;
		}

		const value = Number(raw);
		if (!Number.isFinite(value)) {
			padError = 'Voer een geldig getal in.';
			return;
		}

		setCutProcessValue(padKey, value);
		closePad();
	}

	function formatBytes(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function pickFile() {
		fileInput?.click();
	}

	async function emergencyStopMachine() {
		try {
			await machineApi.emergencyStop();
			emergencyStopState.activate();
		} catch (e: any) {
			lastError = e?.message ?? String(e);
		}
	}

	function pageHidden() {
		return typeof document !== 'undefined' && document.hidden;
	}

	async function refreshState() {
		if (stateRefreshInFlight || pageHidden()) return;

		stateRefreshInFlight = true;
		try {
			const q = await machineApi.getStatus(false);
			const status = q?.result?.status ?? {};
			const printState = status.print_stats?.state ?? '';
			const webhookState = status.webhooks?.state ?? '';

			if (webhookState === 'ready') {
				machineState = printState === 'printing' ? 'Busy' : 'Ready';
			} else if (webhookState === 'error') {
				machineState = 'Error';
			} else if (webhookState) {
				machineState = webhookState.charAt(0).toUpperCase() + webhookState.slice(1);
			} else {
				machineState = printState ? printState.charAt(0).toUpperCase() + printState.slice(1) : 'Unknown';
			}
		} catch {
			machineState = 'Disconnected';
		} finally {
			stateRefreshInFlight = false;
		}
	}

	function statusClass() {
		if (machineState === 'Ready') return 'ok';
		if (machineState === 'Busy') return 'warn';
		if (['Error', 'Disconnected', 'Shutdown', 'Emergency'].includes(machineState)) return 'err';
		return '';
	}

	async function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;

		if (!file) return;

		if (!file.name.toLowerCase().endsWith('.dxf')) {
			selectedFile = null;
			uploadState = 'error';
			lastError = 'Alleen DXF bestanden zijn toegestaan.';
			uploadMessage = 'Ongeldig bestand gekozen.';
			previewLines = [];
			return;
		}

		selectedFile = file;
		uploadState = 'ready';
		lastError = '';
		uploadedPath = '';
		uploadMessage = 'Bestand geladen. Controleer en upload daarna naar Moonraker.';

		try {
			const text = await file.text();
			previewLines = text.split(/\r?\n/).slice(0, 12);
		} catch {
			previewLines = ['Preview niet beschikbaar voor dit bestand.'];
		}
	}

	async function uploadFile() {
		if (!selectedFile) return;

		uploadState = 'uploading';
		uploadMessage = 'Uploaden naar Moonraker...';
		lastError = '';

		try {
			const formData = new FormData();
			formData.append('root', 'gcodes');
			formData.append('path', 'autocut/dxf');
			formData.append('print', 'false');
			formData.append('file', selectedFile, selectedFile.name);

			const payload = await machineApi.upload(formData);

			uploadedPath = payload?.path || `autocut/dxf/${selectedFile.name}`;
			uploadState = 'uploaded';
			uploadMessage = 'DXF staat op Moonraker en is klaar voor verdere verwerking.';
		} catch (e: any) {
			uploadState = 'error';
			lastError = e?.message ?? String(e);
			uploadMessage = 'Upload mislukt.';
		}
	}

	function resetSelection() {
		selectedFile = null;
		previewLines = [];
		uploadState = 'idle';
		uploadMessage = 'Nog geen DXF geladen.';
		uploadedPath = '';
		lastError = '';
		if (fileInput) fileInput.value = '';
	}

	onMount(() => {
		loadCutProcess();
		void refreshState();
		poll = setInterval(refreshState, 1500);

		return () => {
			if (poll) clearInterval(poll);
		};
	});
</script>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
		min-height: calc(100dvh - 28px);
	}

	.emergencyNotice {
		grid-column: 1 / -1;
	}

	.heroHeader {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		min-height: 80px;
		margin-bottom: 4px;
	}

	.headerActions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.statusPill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 56px;
		padding: 0 16px;
		border-radius: 18px;
		border: 1px solid rgba(124, 199, 255, 0.16);
		background: rgba(12, 22, 41, 0.88);
		font-size: 17px;
		font-weight: 850;
		color: #c6d3ff;
	}

	.statusPill.ok {
		color: #a9ffcf;
		border-color: #1f6a49;
	}

	.statusPill.warn {
		color: #ffe2a8;
		border-color: #6a5320;
	}

	.statusPill.err {
		color: #ffb5b5;
		border-color: #7a1f1f;
	}

	.topStopButton {
		min-width: 136px;
		min-height: 56px;
		flex: 0 0 auto;
	}

	.dangerButton {
		background: linear-gradient(180deg, rgba(150, 32, 40, 0.98), rgba(104, 18, 26, 0.98));
		border: 1px solid rgba(255, 154, 154, 0.24);
		color: #fff3f3;
	}

	.emergencyNotice {
		padding: 12px 14px;
		border-radius: 18px;
		border: 1px solid rgba(186, 63, 75, 0.34);
		background: linear-gradient(180deg, rgba(44, 15, 21, 0.96), rgba(25, 9, 13, 0.96));
		color: #ffe8e8;
		font-size: 16px;
		line-height: 1.45;
		font-weight: 700;
	}

	.card {
		background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
		border: 1px solid rgba(109, 146, 219, 0.16);
		border-radius: 22px;
		padding: 16px;
		box-shadow: 0 18px 28px rgba(0, 0, 0, 0.16);
	}

	.hero {
		display: grid;
		gap: 10px;
	}

	.pageTitle {
		margin: 0;
		color: #ffffff;
		font-size: 26px;
		font-weight: 900;
		line-height: 1;
	}

	.dropZone {
		min-height: 210px;
		border-radius: 22px;
		border: 1px dashed rgba(124, 199, 255, 0.28);
		background:
			radial-gradient(circle at top right, rgba(124, 199, 255, 0.12), transparent 36%),
			rgba(9, 18, 34, 0.72);
		display: grid;
		place-items: center;
		text-align: center;
		padding: 24px;
	}

	.dropZone strong {
		display: block;
		font-size: 22px;
		margin-bottom: 8px;
	}

	.actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.muted {
		color: #8fa3c7;
		font-size: 16px;
	}

	.fileGrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.fileCard {
		padding: 12px 14px;
		border-radius: 18px;
		background: rgba(13, 24, 43, 0.84);
		border: 1px solid rgba(124, 199, 255, 0.12);
	}

	.fileCard strong {
		display: block;
		font-size: 22px;
		margin-top: 6px;
	}

	.previewBox {
		padding: 14px;
		border-radius: 18px;
		background: rgba(8, 16, 30, 0.86);
		border: 1px solid rgba(124, 199, 255, 0.12);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
		font-size: 14px;
		white-space: pre-wrap;
		min-height: 168px;
	}

	.processGrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		align-items: stretch;
	}

	.field {
		display: grid;
		gap: 6px;
	}

	.label {
		color: #b7c6ea;
		font-size: 16px;
		font-weight: 800;
	}

	.valueBox {
		background: #0b101b;
		border: 1px solid rgba(124, 199, 255, 0.12);
		border-radius: 18px;
		padding: 14px;
		font-weight: 950;
		font-size: 20px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: #eaf0ff;
		min-height: 58px;
	}

	.helperBox {
		padding: 12px 14px;
		border-radius: 18px;
		background: rgba(8, 16, 30, 0.88);
		border: 1px solid rgba(124, 199, 255, 0.1);
		color: #c6d3ff;
		font-size: 16px;
		line-height: 1.45;
	}

	.helperBox strong {
		display: block;
		margin-bottom: 4px;
		font-size: 17px;
		color: #f0f6ff;
	}

	.ghost { background: transparent; }
	.danger { background: #2a0f14; border-color: #7a1f1f; color: #ffb5b5; }

	.input {
		display: none;
	}

	.errorBox {
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid #7a1f1f;
		background: #1b0d10;
		color: #ffb5b5;
		font-size: 16px;
	}

	@media (max-width: 760px) {
		.page {
			grid-template-columns: 1fr;
			min-height: auto;
		}

		.fileGrid,
		.processGrid {
			grid-template-columns: 1fr;
		}
	}
</style>

<div class="page">
	{#if $emergencyStopState.active}
		<div class="emergencyNotice">{$emergencyStopState.message}</div>
	{/if}

	<section class="card hero">
		<div class="heroHeader">
			<div>
				<div class="pageTitle">DXF snijden</div>
			</div>
			<div class="headerActions">
				<div class={`statusPill ${statusClass()}`}>{machineState}</div>
				<button class="dangerButton topStopButton" on:click={emergencyStopMachine}>Emergency stop</button>
			</div>
		</div>

		<input class="input" bind:this={fileInput} type="file" accept=".dxf,.DXF" on:change={handleFileChange} />

		<div class="dropZone">
			<div>
				<strong>{selectedFile ? selectedFile.name : 'Tik om DXF te laden'}</strong>
				<div class="muted">{uploadMessage}</div>
			</div>
		</div>

		<div class="actions">
			<button class="primary" on:click={pickFile}>DXF kiezen</button>
			<button class="secondary" disabled={!selectedFile || uploadState === 'uploading'} on:click={uploadFile}>Uploaden</button>
			<button class="secondary" disabled={!selectedFile} on:click={resetSelection}>Wissen</button>
		</div>

		{#if lastError}
			<div class="errorBox">{lastError}</div>
		{/if}

		<div class="fileGrid">
			<div class="fileCard">
				<div class="muted">Bestand</div>
				<strong>{selectedFile?.name ?? '-'}</strong>
			</div>
			<div class="fileCard">
				<div class="muted">Grootte</div>
				<strong>{selectedFile ? formatBytes(selectedFile.size) : '-'}</strong>
			</div>
			<div class="fileCard">
				<div class="muted">Moonraker pad</div>
				<strong>{uploadedPath || '-'}</strong>
			</div>
		</div>

		<div class="helperBox">
			<strong>DXF snijparameters</strong>
			Deze parameters worden apart voor DXF bewaard en gebruiken dezelfde grenzen als Vorm snijden.
		</div>

		<div class="processGrid">
			<div class="field">
				<div class="label">Recht snijden</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Recht snijden (mm/min)', 'straightFeedRate', 'mm/min')}>
					{cutProcess.straightFeedRate} mm/min
				</button>
			</div>

			<div class="field">
				<div class="label">Bochten</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Bochten (mm/min)', 'curveFeedRate', 'mm/min')}>
					{cutProcess.curveFeedRate} mm/min
				</button>
			</div>

			<div class="field">
				<div class="label">Snijhoogte</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Snijhoogte (mm)', 'cutHeight', 'mm')}>
					{fmtClean(cutProcess.cutHeight)} mm
				</button>
			</div>

			<div class="field">
				<div class="label">Contact-offset</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Contact-offset (mm)', 'contactOffset', 'mm')}>
					{fmtClean(cutProcess.contactOffset)} mm
				</button>
			</div>

			<div class="field">
				<div class="label">Z omlaag contact</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Z omlaag contact (mm/min)', 'contactDownSpeed', 'mm/min')}>
					{cutProcess.contactDownSpeed} mm/min
				</button>
			</div>

			<div class="field">
				<div class="label">Z omhoog contact</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Z omhoog contact (mm/min)', 'contactLiftSpeed', 'mm/min')}>
					{cutProcess.contactLiftSpeed} mm/min
				</button>
			</div>

			<div class="field">
				<div class="label">Voorlooptijd toorts</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Voorlooptijd toorts (s)', 'torchLeadTime', 's')}>
					{fmtClean(cutProcess.torchLeadTime)} s
				</button>
			</div>

			<div class="field">
				<div class="label">Pauze na contact</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Pauze na contact (s)', 'contactSettleTime', 's')}>
					{fmtClean(cutProcess.contactSettleTime)} s
				</button>
			</div>

			<div class="field">
				<div class="label">Pierce delay</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Pierce delay (s)', 'pierceDelay', 's')}>
					{fmtClean(cutProcess.pierceDelay)} s
				</button>
			</div>

			<div class="field">
				<div class="label">Eind-lift hoogte</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Eind-lift hoogte (mm)', 'finishLiftHeight', 'mm')}>
					{fmtClean(cutProcess.finishLiftHeight)} mm
				</button>
			</div>

			<div class="field">
				<div class="label">Eind-lift snelheid</div>
				<button type="button" class="valueBox" on:click={() => openCutProcessPad('Eind-lift snelheid (mm/min)', 'finishLiftSpeed', 'mm/min')}>
					{cutProcess.finishLiftSpeed} mm/min
				</button>
			</div>
		</div>

		<div class="previewBox">{previewLines.length ? previewLines.join('\n') : 'Preview van de eerste regels verschijnt hier na het laden van een DXF.'}</div>
	</section>
</div>

<NumberPad
	open={padOpen}
	title={padTitle}
	value={padValue}
	subtitle={`Huidig: ${fmtClean(padCurrent)} ${padUnit} · Toegestaan: ${fmtClean(padMin)} – ${fmtClean(padMax)} ${padUnit}`}
	error={padError}
	onClose={closePad}
	onAppend={padAppend}
	onBackspace={padBackspace}
	onClear={padClear}
	onConfirm={confirmPad}
/>
