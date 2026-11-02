// The Mood choice's values. Each is a time, a cover, a wind and a weather; picking one moves the sliders there.
export const MOODS = {
	day: { label: 'Fair day', hint: 'Late morning, scattered cumulus.', time: 10.4, cover: 0.37, wind: 16, weather: 'fair', rain: 0 },
	dawn: { label: 'Dawn', hint: 'The sun just up behind the far shore.', time: 6.5, cover: 0.3, wind: 10, weather: 'fair', rain: 0 },
	dusk: { label: 'Dusk', hint: 'The last of the sun, with the clouds lit from under.', time: 17.45, cover: 0.3, wind: 12, weather: 'fair', rain: 0 },
	wisps: { label: 'High wisps', hint: 'Nearly clear, with long thin streaks up high.', time: 8.6, cover: 0.14, wind: 22, weather: 'clear', rain: 0 },
	overcast: { label: 'Overcast', hint: 'A low grey deck with the sun a pale patch.', time: 12.5, cover: 0.86, wind: 20, weather: 'overcast', rain: 0 },
	storm: { label: 'Storm', hint: 'Heavy dark cloud, driving rain and lightning.', time: 15.2, cover: 0.74, wind: 44, weather: 'storm', rain: 1 },
	night: { label: 'Night', hint: 'Stars and a moon, with its light on the clouds.', time: 21, cover: 0.34, wind: 8, weather: 'fair', rain: 0 },
};
export const FIRST_MOOD = 'dusk';
