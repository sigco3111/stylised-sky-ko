// The Mood choice's values. Each is a time, a cover, a wind and a weather; picking one moves the sliders there.
export const MOODS = {
	day: { label: '맑은 날', hint: '늦은 아침, 드문드문 뜬 뭉게구름.', time: 10.4, cover: 0.37, wind: 16, weather: 'fair', rain: 0 },
	dawn: { label: '새벽', hint: '해가 막 건너편 호숫가 뒤로 떠오른 때.', time: 6.5, cover: 0.3, wind: 10, weather: 'fair', rain: 0 },
	dusk: { label: '황혼', hint: '남은 햇살이 구름 아랫면을 밝히는 시간.', time: 17.45, cover: 0.3, wind: 12, weather: 'fair', rain: 0 },
	wisps: { label: '높은 새털구름', hint: '거의 맑은 하늘, 높은 곳에 길고 가는 구름 조각.', time: 8.6, cover: 0.14, wind: 22, weather: 'clear', rain: 0 },
	overcast: { label: '흐림', hint: '낮게 깔린 회색 구름층, 해는 흐릿한 얼룩.', time: 12.5, cover: 0.86, wind: 20, weather: 'overcast', rain: 0 },
	storm: { label: '폭풍', hint: '무겁고 어두운 구름, 몰아치는 비와 번개.', time: 15.2, cover: 0.74, wind: 44, weather: 'storm', rain: 1 },
	night: { label: '밤', hint: '별과 달, 구름 위에 드리운 달빛.', time: 21, cover: 0.34, wind: 8, weather: 'fair', rain: 0 },
};
export const FIRST_MOOD = 'dusk';
