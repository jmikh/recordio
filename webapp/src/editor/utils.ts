
export function formatTimeCode(ms: number, padMinutes = true) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${padMinutes ? m.toString().padStart(2, '0') : m}:${s.toString().padStart(2, '0')}`;
}
