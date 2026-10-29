import {
  createElement, Power, Sun, Sofa, Film, Moon, DoorOpen, LampFloor, LampDesk, Lightbulb,
  Snowflake, Flame, Droplets, Fan, Wind, Leaf, ChevronDown, ChevronLeft, Plus, Minus, Thermometer,
  SlidersHorizontal, Check, House, Settings2, AirVent, Sparkles, FolderOpen, Plug, SunDim, SunMedium,
  Tv, BedDouble, Palette, RefreshCw, X,
  ShieldCheck, Link2, Copy, MessageSquareText, BookOpen, Terminal, RotateCcw, Globe, Laptop, Clock, Box, Download,
  Undo2, Activity, KeyRound, ArrowUpRight, Camera, Square,
  HouseWifi, Smartphone, Radar, CircleCheck, CircleAlert, ChevronRight, Unlink, LoaderCircle, Router,
  List, Trash2, Scan, Redo2, Map as MapIcon, DoorClosed, Armchair,
  LightbulbOff, EyeOff, Trees, ToggleRight, Bot, Footprints, Eye, ArrowUp, ArrowDown,
} from 'lucide';

// A sliding gate on its rail against the post it closes on, shut and slid open (drawn for
// HomeOs Bar in Lucide's grid and stroke, so it sits with the other icons).
const GateClosed = [
  ['path', { d: 'M2 20.5h20' }],
  ['path', { d: 'M20.5 3v17.5' }],
  ['rect', { x: '2.5', y: '5.5', width: '15.5', height: '12.5', rx: '1' }],
  ['path', { d: 'M2.5 9.75H18' }], ['path', { d: 'M2.5 13.75H18' }],
];
const GateOpen = [
  ['path', { d: 'M2 20.5h20' }],
  ['path', { d: 'M20.5 3v17.5' }],
  ['rect', { x: '2.5', y: '5.5', width: '7', height: '12.5', rx: '1' }],
  ['path', { d: 'M2.5 9.75h7' }], ['path', { d: 'M2.5 13.75h7' }],
  ['path', { d: 'M17.5 11.75h-5' }], ['path', { d: 'm14.75 9.25-2.25 2.5 2.25 2.5' }],
];

// Light fixtures, drawn for HomeOs Bar in the same grid and stroke: what each lamp is.
const FIXTURES = {
  ceiling: [
    ['path', { d: 'M3 4h18' }], ['path', { d: 'M12 4v3' }], ['path', { d: 'M5 10a7 3 0 0 1 14 0z' }],
    ['path', { d: 'M8.5 14.5 7 18' }], ['path', { d: 'M12 14.5V19' }], ['path', { d: 'M15.5 14.5 17 18' }],
  ],
  ceilingSquare: [
    ['path', { d: 'M3 4h18' }], ['path', { d: 'M12 4v3' }], ['rect', { x: '5', y: '7.5', width: '14', height: '3', rx: '0.8' }],
    ['path', { d: 'M8.5 14 7 18' }], ['path', { d: 'M12 14v5' }], ['path', { d: 'M15.5 14 17 18' }],
  ],
  spots: [
    ['path', { d: 'M2 4h20' }], ['path', { d: 'M5 4v3.5h4V4' }], ['path', { d: 'M15 4v3.5h4V4' }],
    ['path', { d: 'm5 11-2 9' }], ['path', { d: 'm9 11 2 9' }], ['path', { d: 'm15 11-2 9' }], ['path', { d: 'm19 11 2 9' }],
  ],
  strip: [
    ['rect', { x: '2', y: '7', width: '20', height: '3.5', rx: '1' }], ['path', { d: 'M4.5 8.75h15' }],
    ['path', { d: 'm5 14-1 3' }], ['path', { d: 'M9.5 14v4' }], ['path', { d: 'M14.5 14v4' }], ['path', { d: 'm19 14 1 3' }],
  ],
  stripL: [
    ['path', { d: 'M3 3v15.5a1.5 1.5 0 0 0 1.5 1.5H21' }], ['path', { d: 'M6.5 3v13.5H21' }],
    ['path', { d: 'm10 13 1.5-1.5' }], ['path', { d: 'm13.5 13 1.5-1.5' }], ['path', { d: 'm17 13 1.5-1.5' }],
    ['path', { d: 'm10 9.5 1.5-1.5' }], ['path', { d: 'm10 6 1.5-1.5' }],
  ],
  flood: [
    ['path', { d: 'M2 9v6' }], ['rect', { x: '4', y: '8', width: '6', height: '8', rx: '1.5' }],
    ['path', { d: 'M10 9.5 21 4' }], ['path', { d: 'M10 14.5 21 20' }], ['path', { d: 'M13 12h8' }],
  ],
  pendant: [['path', { d: 'M12 2v6' }], ['path', { d: 'M5 15a7 7 0 0 1 14 0z' }], ['path', { d: 'M10 18.5a2 2 0 0 0 4 0' }]],
};

const ICONS = {
  power: Power, sun: Sun, sofa: Sofa, film: Film, moon: Moon, door: DoorOpen,
  ...FIXTURES, floor: LampFloor, table: LampDesk,
  cool: Snowflake, heat: Flame, dry: Droplets, fan: Fan, auto: RefreshCw, wind: Wind, leaf: Leaf,
  down: ChevronDown, back: ChevronLeft, plus: Plus, minus: Minus, thermo: Thermometer,
  sliders: SlidersHorizontal, check: Check, home: House, settings: Settings2, ac: AirVent,
  folder: FolderOpen, plug: Plug, dim: SunDim, bright: SunMedium, tv: Tv, bed: BedDouble,
  palette: Palette, sparkles: Sparkles, close: X,
  shield: ShieldCheck, link: Link2, copy: Copy, chat: MessageSquareText, book: BookOpen, terminal: Terminal,
  rotate: RotateCcw, globe: Globe, laptop: Laptop, clock: Clock, box: Box, download: Download, undo: Undo2,
  activity: Activity, key: KeyRound, external: ArrowUpRight, camera: Camera, stop: Square,
  homeassistant: HouseWifi, phone: Smartphone, radar: Radar, ok: CircleCheck, alert: CircleAlert,
  next: ChevronRight, unlink: Unlink, spinner: LoaderCircle, bridge: Router, bulb: Lightbulb,
  list: List, trash: Trash2, fit: Scan, redo: Redo2, map: MapIcon, opening: DoorClosed, furniture: Armchair,
  gate: GateClosed, gateOpen: GateOpen, lightsOff: LightbulbOff, outside: Trees, toggle: ToggleRight, automation: Bot,
  presence: Footprints, eye: Eye, eyeOff: EyeOff, up: ArrowUp, downArrow: ArrowDown,
};

export function icon(name, size = 18, stroke = 1.8) {
  const el = createElement(ICONS[name] || ICONS.sparkles);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('stroke-width', stroke);
  el.classList.add('icon');
  return el;
}

/** A lamp shows its fixture; one that is really a smart plug (a `switch.*` entity), a plug. */
export function lampIcon(cfg) {
  if (cfg.link?.id?.startsWith('switch.') || !cfg.type) return 'plug';
  if (cfg.type === 'ceiling' && cfg.shape === 'square') return 'ceilingSquare';
  if (cfg.type === 'strip' && cfg.corner > 0) return 'stripL';
  return cfg.type;
}
