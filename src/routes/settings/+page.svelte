<script lang="ts">
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import { defaultUiSettings, type UiSettings, uiSettings } from '$lib/ui-settings';

	let settings: UiSettings = defaultUiSettings;

	function toggle(key: 'developerMode' | 'showInstructions') {
		uiSettings.patch({ [key]: !settings[key] } as Partial<UiSettings>);
	}

	function setLanguage(language: 'nl' | 'en') {
		uiSettings.patch({ language });
	}

	function setTravelHeight(value: number) {
		const travelHeightMm = Math.min(100, Math.max(0.1, Math.round(value * 10) / 10));
		uiSettings.patch({ travelHeightMm });
	}

	function setEndstopReleaseDelay(value: number) {
		const seconds = Number.isFinite(value) ? value : 0.5;
		const endstopReleaseDelayMs = Math.round(Math.min(10, Math.max(0, seconds)) * 1000);
		uiSettings.patch({ endstopReleaseDelayMs });
	}

	onMount(() => {
		uiSettings.load();
		settings = get(uiSettings);
		return uiSettings.subscribe((value) => {
			settings = value;
		});
	});
</script>

<style>
	.page {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.pageHeader {
		grid-column: 1 / -1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		min-height: 96px;
		border-radius: 22px;
		background:
			radial-gradient(circle at top right, rgba(124, 199, 255, 0.14), transparent 34%),
			linear-gradient(180deg, rgba(12, 21, 40, 0.98), rgba(8, 16, 29, 0.98));
		border: 1px solid rgba(124, 199, 255, 0.16);
	}

	.pageTitle {
		margin: 0;
		font-size: 26px;
		font-weight: 950;
		line-height: 1;
	}

	.pageLead {
		margin-top: 6px;
		color: #c7d5eb;
		font-size: 17px;
		line-height: 1.4;
	}

	.card {
		background: linear-gradient(180deg, rgba(11, 19, 35, 0.98), rgba(7, 14, 26, 0.98));
		border: 1px solid rgba(109, 146, 219, 0.16);
		border-radius: 22px;
		padding: 16px;
		box-shadow: 0 18px 28px rgba(0, 0, 0, 0.16);
	}

	.full {
		grid-column: 1 / -1;
	}

	h1, h2 {
		margin: 0 0 10px;
	}

	h2 {
		font-size: 22px;
	}

	.settingList {
		display: grid;
		gap: 10px;
		margin-top: 14px;
	}

	.settingItem {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px;
		border-radius: 18px;
		background: rgba(13, 24, 43, 0.84);
		border: 1px solid rgba(124, 199, 255, 0.12);
	}

	.settingItem strong {
		display: block;
		margin-bottom: 4px;
		font-size: 18px;
	}

	.muted {
		color: #8fa3c7;
		font-size: 16px;
	}

	.toggle {
		width: 58px;
		height: 34px;
		border-radius: 999px;
		background: rgba(20, 33, 58, 0.96);
		border: 1px solid rgba(124, 199, 255, 0.18);
		position: relative;
		flex: 0 0 auto;
	}

	.toggle.active {
		background: linear-gradient(180deg, rgba(92, 144, 255, 0.96), rgba(60, 104, 198, 0.96));
	}

	.toggle::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 4px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #f5fbff;
		transition: transform 0.18s ease;
	}

	.toggle.active::after {
		transform: translateX(24px);
	}

	.numberInput {
		width: 120px;
		min-height: 48px;
		border-radius: 14px;
		border: 1px solid rgba(124, 199, 255, 0.18);
		background: rgba(7, 16, 30, 0.92);
		color: #ffffff;
		font-size: 20px;
		font-weight: 900;
		padding: 8px 10px;
	}

	@media (max-width: 760px) {
		.page {
			grid-template-columns: 1fr;
		}
	}
</style>

<div class="page">
	<section class="pageHeader">
		<div>
			<h1 class="pageTitle">Instellingen</h1>
		</div>
	</section>

	<section class="card">
		<h2>Gedrag</h2>
		<div class="settingList">
			<div class="settingItem">
				<div>
					<strong>Ontwikkelmodus</strong>
					<div class="muted">Toon ontwikkelmacro's onderaan handbediening.</div>
				</div>
				<button class={`toggle ${settings.developerMode ? 'active' : ''}`} aria-label="Toggle ontwikkelmodus" on:click={() => toggle('developerMode')}></button>
			</div>

			<div class="settingItem">
				<div>
					<strong>Autoscroll</strong>
					<div class="muted">Spring automatisch naar de volgende stap in de vorm-workflow.</div>
				</div>
				<button class={`toggle ${settings.autoScroll ? 'active' : ''}`} aria-label="Toggle autoscroll" on:click={() => uiSettings.patch({ autoScroll: !settings.autoScroll })}></button>
			</div>

			<div class="settingItem">
				<div>
					<strong>Bedieningsinstructies</strong>
					<div class="muted">Toon bedieningsinstructies bij het starten van de applicatie.</div>
				</div>
				<button class={`toggle ${settings.showInstructions ? 'active' : ''}`} aria-label="Toggle bedieningsinstructies" on:click={() => toggle('showInstructions')}></button>
			</div>


			<div class="settingItem">
				<div>
					<strong>Afvalvertraging eindstop</strong>
					<div class="muted">Tijd dat het eindstoplampje zichtbaar blijft na triggeren.</div>
				</div>
				<input
					class="numberInput"
					type="number"
					min="0"
					max="10"
					step="0.1"
					value={settings.endstopReleaseDelayMs / 1000}
					on:change={(event) => setEndstopReleaseDelay(Number(event.currentTarget.value))}
					aria-label="Afvalvertraging eindstop in seconden"
				/>
			</div>
		</div>
	</section>

</div>
