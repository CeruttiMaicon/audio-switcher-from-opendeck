export type MasterVolumeSvgOptions = {
	percent: number;
	muted: boolean;
	/** When true, volume could not be read — neutral ring only (label comes from `setTitle` / layout text). */
	unknown?: boolean;
	/**
	 * When true, omit all SVG text (some hosts do not render text inside plugin SVGs).
	 * Use `setTitle` on keys and a layout `text` item on encoders for the percentage.
	 */
	omitCenterText?: boolean;
	/** Square side (keys) or width (encoder strip). */
	size: number;
	/** Height for encoder layout (e.g. 100); defaults to `size` when square. */
	height?: number;
	/**
	 * Menos defs SVG (sem glow/blur nem gradiente no arco) — muito mais barato em CPU e menos bytes no IPC.
	 * Recomendado para o dial durante giro; teclas podem usar o estilo completo.
	 */
	renderLite?: boolean;
};

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function uniqueSuffix(
	w: number,
	h: number,
	pct: number,
	muted: boolean,
	unknown: boolean,
	omitText: boolean,
	lite: boolean,
): string {
	return `${w}_${h}_${pct}_${muted ? 1 : 0}_${unknown ? 1 : 0}_${omitText ? 1 : 0}_${lite ? 1 : 0}`.replace(
		/\./g,
		"d",
	);
}

function svgRoundFace(
	S: number,
	pct: number,
	muted: boolean,
	unknown: boolean,
	omitText: boolean,
	lite: boolean,
): string {
	const id = uniqueSuffix(S, S, pct, muted, unknown, omitText, lite);
	const cx = S / 2;
	const cy = S / 2;
	const clipR = S * 0.499;
	const faceR = S * 0.46;
	const ringR = S * 0.385;
	const stroke = Math.max(S * 0.075, 8);
	const c = 2 * Math.PI * ringR;
	const dash = unknown ? 0 : (pct / 100) * c;
	const gap = c - dash;
	const accent = unknown ? "#52525b" : muted ? "#fb923c" : lite ? "#38bdf8" : `url(#mvGrad_${id})`;
	const mainSize = S * (unknown ? 0.22 : muted ? 0.26 : 0.3);
	const subSize = S * 0.11;
	const centerLabel = unknown ? "—" : `${pct}%`;

	const textBlock: string[] = [];
	if (!omitText) {
		textBlock.push(
			`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${unknown ? "#71717a" : "#f8fafc"}"`,
			` font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${mainSize}" letter-spacing="-0.03em">${escapeXml(centerLabel)}</text>`,
		);
		if (!unknown && muted) {
			textBlock.push(
				`<text x="${cx}" y="${cy + S * 0.2}" text-anchor="middle" dominant-baseline="middle" fill="#fdba74" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${subSize}" letter-spacing="0.06em">${escapeXml("MUTED")}</text>`,
			);
		}
	}

	const fancyArc =
		!unknown && !lite
			? `<linearGradient id="mvGrad_${id}" x1="0%" y1="0%" x2="100%" y2="100%">` +
				`<stop offset="0%" stop-color="#38bdf8"/>` +
				`<stop offset="100%" stop-color="#818cf8"/>` +
				`</linearGradient>` +
				`<filter id="mvGlow_${id}" x="-50%" y="-50%" width="200%" height="200%">` +
				`<feGaussianBlur stdDeviation="1.4" result="b"/>` +
				`<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
				`</filter>`
			: "";

	const progressStrokeAttrs = unknown
		? ` stroke-dasharray="${dash} ${gap}"/>`
		: lite
			? ` stroke-dasharray="${dash} ${gap}"/>`
			: ` stroke-dasharray="${dash} ${gap}" filter="url(#mvGlow_${id})"/>`;

	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
		`<defs>`,
		`<clipPath id="mvClip_${id}"><circle cx="${cx}" cy="${cy}" r="${clipR}"/></clipPath>`,
		`<radialGradient id="mvBg_${id}" cx="35%" cy="30%" r="75%">`,
		`<stop offset="0%" stop-color="#2d3548"/>`,
		`<stop offset="55%" stop-color="#1a1f2e"/>`,
		`<stop offset="100%" stop-color="#12151c"/>`,
		`</radialGradient>`,
		fancyArc,
		`</defs>`,
		`<g clip-path="url(#mvClip_${id})">`,
		`<circle cx="${cx}" cy="${cy}" r="${faceR}" fill="url(#mvBg_${id})"/>`,
		`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#1f2937" stroke-width="${stroke}" opacity="0.95"/>`,
		`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="${stroke}"`,
		` stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"`,
		progressStrokeAttrs,
		...textBlock,
		`</g>`,
		`</svg>`,
	].join("");
}

function svgWideFace(
	w: number,
	h: number,
	pct: number,
	muted: boolean,
	unknown: boolean,
	omitText: boolean,
	lite: boolean,
): string {
	const id = uniqueSuffix(w, h, pct, muted, unknown, omitText, lite);
	const cx = w / 2;
	const cy = h / 2;
	const S = Math.min(w, h);
	const clipR = Math.min(w, h) * 0.48;
	const faceR = Math.min(w, h) * 0.44;
	const ringR = S * 0.36;
	const stroke = Math.max(S * 0.07, 6);
	const c = 2 * Math.PI * ringR;
	const dash = unknown ? 0 : (pct / 100) * c;
	const gap = c - dash;
	const accent = unknown ? "#52525b" : muted ? "#fb923c" : lite ? "#38bdf8" : `url(#mvGrad_${id})`;
	const mainSize = S * (unknown ? 0.28 : 0.34);
	const subSize = S * 0.12;
	const centerLabel = unknown ? "—" : `${pct}%`;

	const textBlock: string[] = [];
	if (!omitText) {
		textBlock.push(
			`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${unknown ? "#71717a" : "#f8fafc"}"`,
			` font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${mainSize}" letter-spacing="-0.03em">${escapeXml(centerLabel)}</text>`,
		);
		if (!unknown && muted) {
			textBlock.push(
				`<text x="${cx}" y="${cy + h * 0.22}" text-anchor="middle" dominant-baseline="middle" fill="#fdba74" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${subSize}" letter-spacing="0.06em">${escapeXml("MUTED")}</text>`,
			);
		}
	}

	const fancyArcWide =
		!unknown && !lite
			? `<linearGradient id="mvGrad_${id}" x1="0%" y1="0%" x2="100%" y2="100%">` +
				`<stop offset="0%" stop-color="#38bdf8"/>` +
				`<stop offset="100%" stop-color="#818cf8"/>` +
				`</linearGradient>` +
				`<filter id="mvGlow_${id}" x="-50%" y="-50%" width="200%" height="200%">` +
				`<feGaussianBlur stdDeviation="1.2" result="b"/>` +
				`<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
				`</filter>`
			: "";

	const progressStrokeWide = unknown
		? ` stroke-dasharray="${dash} ${gap}"/>`
		: lite
			? ` stroke-dasharray="${dash} ${gap}"/>`
			: ` stroke-dasharray="${dash} ${gap}" filter="url(#mvGlow_${id})"/>`;

	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
		`<defs>`,
		`<clipPath id="mvClip_${id}"><circle cx="${cx}" cy="${cy}" r="${clipR}"/></clipPath>`,
		`<radialGradient id="mvBg_${id}" cx="35%" cy="30%" r="75%">`,
		`<stop offset="0%" stop-color="#2d3548"/>`,
		`<stop offset="55%" stop-color="#1a1f2e"/>`,
		`<stop offset="100%" stop-color="#12151c"/>`,
		`</radialGradient>`,
		fancyArcWide,
		`</defs>`,
		`<rect width="${w}" height="${h}" fill="#12151c"/>`,
		`<g clip-path="url(#mvClip_${id})">`,
		`<circle cx="${cx}" cy="${cy}" r="${faceR}" fill="url(#mvBg_${id})"/>`,
		`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#1f2937" stroke-width="${stroke}" opacity="0.95"/>`,
		`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="${stroke}"`,
		` stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"`,
		progressStrokeWide,
		...textBlock,
		`</g>`,
		`</svg>`,
	].join("");
}

/**
 * SVG ring/background for `setImage` / encoder `setFeedback` pixmap.
 * Prefer `omitCenterText: true` on hosts that do not draw SVG text; show the value with `setTitle` or layout `text`.
 */
export function buildMasterVolumeSvg(opts: MasterVolumeSvgOptions): string {
	const w = opts.size;
	const h = opts.height ?? opts.size;
	const pct = Math.min(100, Math.max(0, Math.round(opts.percent)));
	const unknown = Boolean(opts.unknown);
	const omitText = Boolean(opts.omitCenterText);
	const lite = Boolean(opts.renderLite);
	const square = Math.abs(w - h) < 0.001;
	if (square) {
		return svgRoundFace(w, pct, opts.muted, unknown, omitText, lite);
	}
	return svgWideFace(w, h, pct, opts.muted, unknown, omitText, lite);
}

/** Label for key title / encoder text item. */
export function masterVolumePercentLabel(unknown: boolean, muted: boolean, pct: number): string {
	if (unknown) {
		return "—";
	}
	if (muted) {
		return `${pct}%  MUTED`;
	}
	return `${pct}%`;
}
