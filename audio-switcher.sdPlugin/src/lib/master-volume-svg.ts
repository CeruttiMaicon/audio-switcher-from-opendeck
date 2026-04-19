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

/** Paths de `imgs/volume-speaker-svgrepo-com.svg` (viewBox 0 0 512 512). */
export const SPEAKER_PATH_MARKUP =
	'<path d="M240.478,42.234l-140.282,96.87v233.791l140.282,96.87c10.986,8.178,26.712,0.38,26.712-13.373V55.607 C267.19,41.939,251.545,34.024,240.478,42.234z"/>' +
	'<path d="M438.761,89.335c-6.523-6.523-17.091-6.523-23.614,0s-6.523,17.091,0,23.614c84.606,84.638,84.606,222.408,0,307.047 c-6.523,6.523-6.523,17.091,0,23.614c6.524,6.524,17.091,6.524,23.614,0C536.413,345.925,536.413,187.019,438.761,89.335z"/>' +
	'<path d="M391.501,136.563c-6.523-6.523-17.091-6.523-23.614,0c-6.523,6.523-6.523,17.091,0,23.614 c58.578,58.61,58.578,153.981,0,212.591c-6.523,6.523-6.523,17.091,0,23.614c6.524,6.524,17.091,6.524,23.614,0 C463.093,324.757,463.093,208.187,391.501,136.563z"/>' +
	'<path d="M344.305,183.823c-6.523-6.523-17.091-6.523-23.614,0c-6.523,6.523-6.523,17.091,0,23.614 c32.55,32.55,32.55,85.519-0.032,118.103c-6.523,6.523-6.523,17.09,0,23.614c6.523,6.524,17.091,6.524,23.614,0 C389.87,303.556,389.87,229.388,344.305,183.823z"/>' +
	'<path d="M16.699,139.104C7.477,139.104,0,146.581,0,155.804v200.393c0,9.223,7.477,16.699,16.699,16.699h50.098V139.104H16.699z"/>';

/** Verde alinhado ao ícone de referência; laranja quando muted; cinza quando unknown. */
export function volumeSpeakerFill(unknown: boolean, muted: boolean): string {
	if (unknown) {
		return "#64748b";
	}
	if (muted) {
		return "#fb923c";
	}
	return "#4ade80";
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
	const cx = S / 2;
	const cy = S / 2;
	const clipR = S * 0.499;
	const faceR = S * 0.46;
	const ringR = S * 0.385;
	const stroke = Math.max(S * 0.075, 8);
	const c = 2 * Math.PI * ringR;
	const dash = unknown ? 0 : (pct / 100) * c;
	const gap = c - dash;
	const id = uniqueSuffix(S, S, pct, muted, unknown, omitText, lite);
	const accent = unknown ? "#52525b" : muted ? "#fb923c" : lite ? "#38bdf8" : `url(#mvGrad_${id})`;
	const mainSize = S * (unknown ? 0.2 : muted ? 0.24 : 0.26);
	const subSize = S * 0.11;
	const centerLabel = unknown ? "—" : `${pct}%`;

	const k = S / 144;
	const spFill = volumeSpeakerFill(unknown, muted);
	const sc = 0.056 * k;
	/** Porcentagem em cima, altifalante centrado por baixo (evita texto a cortar o anel). */
	const pctY = -0.12 * S;
	const iconY = 0.1 * S;
	const iconT = `translate(0,${iconY}) translate(${-256 * sc},${-256 * sc}) scale(${sc})`;
	const textBlock: string[] = [];
	if (!omitText) {
		textBlock.push(
			`<g transform="translate(${cx},${cy})">`,
			`<text x="0" y="${pctY}" text-anchor="middle" dominant-baseline="middle" fill="${unknown ? "#71717a" : "#f8fafc"}"`,
			` font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${mainSize}" letter-spacing="-0.03em">${escapeXml(centerLabel)}</text>`,
			`<g transform="${iconT}" fill="${spFill}">${SPEAKER_PATH_MARKUP}</g>`,
			`</g>`,
		);
		if (!unknown && muted) {
			textBlock.push(
				`<text x="${cx}" y="${cy + S * 0.24}" text-anchor="middle" dominant-baseline="middle" fill="#fdba74" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${subSize}" letter-spacing="0.06em">${escapeXml("MUTED")}</text>`,
			);
		}
	}

	const strokeDashClose = ` stroke-dasharray="${dash} ${gap}"/>`;

	if (lite) {
		return [
			`<?xml version="1.0" encoding="UTF-8"?>`,
			`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
			`<circle cx="${cx}" cy="${cy}" r="${faceR}" fill="#1a1f2e"/>`,
			`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#1f2937" stroke-width="${stroke}" opacity="0.95"/>`,
			`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="${stroke}"`,
			` stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"`,
			strokeDashClose,
			...textBlock,
			`</svg>`,
		].join("");
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
	const id = uniqueSuffix(w, h, pct, muted, unknown, omitText, lite);
	const accent = unknown ? "#52525b" : muted ? "#fb923c" : lite ? "#38bdf8" : `url(#mvGrad_${id})`;
	const mainSize = S * (unknown ? 0.26 : 0.3);
	const subSize = S * 0.12;
	const centerLabel = unknown ? "—" : `${pct}%`;

	const k = S / 144;
	const spFill = volumeSpeakerFill(unknown, muted);
	const sc = 0.052 * k;
	const pctY = -0.11 * S;
	const iconY = 0.09 * S;
	const iconT = `translate(0,${iconY}) translate(${-256 * sc},${-256 * sc}) scale(${sc})`;
	const textBlock: string[] = [];
	if (!omitText) {
		textBlock.push(
			`<g transform="translate(${cx},${cy})">`,
			`<text x="0" y="${pctY}" text-anchor="middle" dominant-baseline="middle" fill="${unknown ? "#71717a" : "#f8fafc"}"`,
			` font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${mainSize}" letter-spacing="-0.03em">${escapeXml(centerLabel)}</text>`,
			`<g transform="${iconT}" fill="${spFill}">${SPEAKER_PATH_MARKUP}</g>`,
			`</g>`,
		);
		if (!unknown && muted) {
			textBlock.push(
				`<text x="${cx}" y="${cy + h * 0.26}" text-anchor="middle" dominant-baseline="middle" fill="#fdba74" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${subSize}" letter-spacing="0.06em">${escapeXml("MUTED")}</text>`,
			);
		}
	} else if (w > h + 0.001) {
		textBlock.push(
			`<g transform="translate(10, 8) scale(0.032)" fill="${spFill}">${SPEAKER_PATH_MARKUP}</g>`,
		);
	}

	const strokeDashWideClose = ` stroke-dasharray="${dash} ${gap}"/>`;

	if (lite) {
		return [
			`<?xml version="1.0" encoding="UTF-8"?>`,
			`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
			`<rect width="${w}" height="${h}" fill="#12151c"/>`,
			`<circle cx="${cx}" cy="${cy}" r="${faceR}" fill="#1a1f2e"/>`,
			`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#1f2937" stroke-width="${stroke}" opacity="0.95"/>`,
			`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="${stroke}"`,
			` stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"`,
			strokeDashWideClose,
			...textBlock,
			`</svg>`,
		].join("");
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
