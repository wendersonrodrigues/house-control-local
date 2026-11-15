import {
  createElement, Power, Sun, Sofa, Film, Moon, DoorOpen, LampFloor, LampDesk, Lightbulb,
  Snowflake, Flame, Droplets, Fan, Wind, Leaf, ChevronDown, ChevronLeft, Plus, Minus, Thermometer,
  SlidersHorizontal, Check, House, Settings2, AirVent, Sparkles, FolderOpen, Plug, SunDim, SunMedium,
  Tv, BedDouble, Palette, RefreshCw, X,
  ShieldCheck, Link2, Copy, MessageSquareText, BookOpen, Terminal, RotateCcw, Globe, Laptop, Clock, Box, Download,
  Undo2, Activity, KeyRound, ArrowUpRight, Camera, Square, Info, Pin, PinOff,
  HouseWifi, Smartphone, Radar, CircleCheck, CircleAlert, ChevronRight, Unlink, LoaderCircle, Router,
  List, Trash2, Scan, Redo2, Map as MapIcon, DoorClosed, Armchair,
  LightbulbOff, EyeOff, Car, CookingPot, Bath, ShowerHead, Shirt, Baby, BedSingle, WashingMachine, Dumbbell, Gamepad2, Flower2, Briefcase, Utensils, Trees, ToggleRight, Bot, Footprints, Eye, ArrowUp, ArrowDown,
  Pencil, ArrowLeftRight, LayoutGrid, Cctv, CameraOff,
  Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle, CloudLightning, CloudSnow, CloudFog, CloudHail, MoonStar,
  Mic, Megaphone, BellOff, Speaker, Umbrella,
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

// A room's icon, for the room chips shown as icons (Organizar o painel). The editor offers
// these by name; without a choice, one is picked from the room's name.
export const ROOM_ICONS = {
  home: 'Casa', car: 'Garagem', sofa: 'Sala', tv: 'Sala de TV', kitchen: 'Cozinha', dining: 'Sala de jantar',
  bed: 'Quarto de casal', bedSingle: 'Quarto', baby: 'Quarto de criança', bath: 'Banheiro', shower: 'Chuveiro',
  closet: 'Closet', laptop: 'Escritório', briefcase: 'Trabalho', laundry: 'Lavanderia', gym: 'Academia',
  games: 'Jogos', outside: 'Quintal', garden: 'Jardim', presence: 'Corredor', door: 'Entrada',
};
const ROOM_GUESS = [
  [/garag/i, 'car'], [/cozinha|kitchen/i, 'kitchen'], [/jantar|dining/i, 'dining'], [/sala de tv|tv\b/i, 'tv'],
  [/sala|estar|living/i, 'sofa'], [/su[ií]te|casal|principal|master/i, 'bed'], [/beb[eê]|crian|kid/i, 'baby'],
  [/quarto|bed/i, 'bedSingle'], [/banh|lavabo|wc|bath/i, 'bath'], [/closet|vesti/i, 'closet'],
  [/office|escrit[oó]rio|estudo/i, 'laptop'], [/lavand|[áa]rea de servi/i, 'laundry'], [/academia|gym/i, 'gym'],
  [/jardim|garden/i, 'garden'], [/quintal|[áa]rea externa|varanda|yard|patio|p[áa]tio/i, 'outside'],
  [/corredor|circula|passagem|hall/i, 'presence'], [/entrada|hall/i, 'door'],
];
export function roomIcon(room) {
  if (room?.icon && ROOM_ICONS[room.icon]) return room.icon;
  const text = `${room?.name || ''} ${room?.id || ''}`;
  return ROOM_GUESS.find(([re]) => re.test(text))?.[1] || 'home';
}

const ICONS = {
  power: Power, sun: Sun, sofa: Sofa, film: Film, moon: Moon, door: DoorOpen,
  ...FIXTURES, floor: LampFloor, table: LampDesk,
  car: Car, kitchen: CookingPot, bath: Bath, shower: ShowerHead, closet: Shirt, baby: Baby, bedSingle: BedSingle,
  laundry: WashingMachine, gym: Dumbbell, games: Gamepad2, garden: Flower2, briefcase: Briefcase, dining: Utensils,
  cool: Snowflake, heat: Flame, dry: Droplets, fan: Fan, auto: RefreshCw, wind: Wind, leaf: Leaf,
  down: ChevronDown, back: ChevronLeft, plus: Plus, minus: Minus, thermo: Thermometer,
  sliders: SlidersHorizontal, check: Check, home: House, settings: Settings2, ac: AirVent,
  folder: FolderOpen, plug: Plug, dim: SunDim, bright: SunMedium, tv: Tv, bed: BedDouble,
  palette: Palette, sparkles: Sparkles, close: X,
  shield: ShieldCheck, link: Link2, copy: Copy, chat: MessageSquareText, book: BookOpen, terminal: Terminal,
  rotate: RotateCcw, globe: Globe, laptop: Laptop, clock: Clock, box: Box, download: Download, undo: Undo2,
  activity: Activity, key: KeyRound, external: ArrowUpRight, camera: Camera, stop: Square, cctv: Cctv, cameraOff: CameraOff,
  homeassistant: HouseWifi, phone: Smartphone, radar: Radar, ok: CircleCheck, alert: CircleAlert,
  next: ChevronRight, unlink: Unlink, spinner: LoaderCircle, bridge: Router, bulb: Lightbulb,
  list: List, trash: Trash2, fit: Scan, redo: Redo2, map: MapIcon, opening: DoorClosed, furniture: Armchair,
  gate: GateClosed, gateOpen: GateOpen, lightsOff: LightbulbOff, outside: Trees, toggle: ToggleRight, automation: Bot,
  presence: Footprints, eye: Eye, eyeOff: EyeOff, up: ArrowUp, downArrow: ArrowDown,
  edit: Pencil, swap: ArrowLeftRight, layout: LayoutGrid, info: Info, pin: Pin, pinOff: PinOff,
  // the weather (ui/weather.js) and the Alexa
  cloud: Cloud, cloudSun: CloudSun, cloudMoon: CloudMoon, rain: CloudRain, drizzle: CloudDrizzle,
  storm: CloudLightning, snow: CloudSnow, fog: CloudFog, hail: CloudHail, clearNight: MoonStar,
  mic: Mic, megaphone: Megaphone, bellOff: BellOff, speaker: Speaker, umbrella: Umbrella,
};

// Filled glyphs made for HomeOs Bar in Magnific (vector), on their own grid: switch every
// light of the room in view on or off.
const FILLED = {
  // A security camera, filled (visor, body with the lens and its light, arm, base): the card of
  // a camera, drawn for HomeOs Bar like the round switches of the air and TV cards.
  cctvFilled: { viewBox: '0.3 0.4 21 21', rule: 'evenodd', d: 'M4.57 6.5L15.1 4.07A2.4 2.4 0 0 1 17.98 5.87L18.43 7.82A2.4 2.4 0 0 1 16.63 10.7L6.1 13.13A2.4 2.4 0 0 1 3.22 11.33L2.77 9.38A2.4 2.4 0 0 1 4.57 6.5ZM13.32 7.5a2.05 2.05 0 1 0 4.1 0a2.05 2.05 0 1 0 -4.1 0ZM14.37 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0ZM4.83 9.96a0.75 0.75 0 1 0 1.5 0a0.75 0.75 0 1 0 -1.5 0ZM1.32 5.1L16.23 1.66A0.75 0.75 0 0 1 17.13 2.22L17.13 2.22A0.75 0.75 0 0 1 16.57 3.12L1.66 6.56A0.75 0.75 0 0 1 0.76 6L0.76 6A0.75 0.75 0 0 1 1.32 5.1ZM8.15 12.9L9.05 12.9A0.7 0.7 0 0 1 9.75 13.6L9.75 15.8A0.7 0.7 0 0 1 9.05 16.5L8.15 16.5A0.7 0.7 0 0 1 7.45 15.8L7.45 13.6A0.7 0.7 0 0 1 8.15 12.9ZM5.1 17.7L12.1 17.7A1.3 1.3 0 0 1 13.4 19L13.4 19A1.3 1.3 0 0 1 12.1 20.3L5.1 20.3A1.3 1.3 0 0 1 3.8 19L3.8 19A1.3 1.3 0 0 1 5.1 17.7Z' },
  allOn: { viewBox: '199 192 1648 1648', d: 'M 1020.8 689.4 C 1034.3 689.5 1047.5 689.6 1061 690.7 C 1157.3 698.7 1246.5 744.7 1309.0 818.6 C 1373.2 895.4 1404.6 994.4 1396.4 1094.2 C 1388.9 1174.1 1355.6 1249.4 1301.4 1308.5 C 1287.0 1324.2 1274.3 1335.2 1258.1 1348.8 C 1257.8 1391.7 1265.8 1434.1 1233.5 1466.3 C 1201.7 1498.0 1158.8 1491.9 1116.9 1492 L 1034.3 1492.1 L 937.5 1492.0 C 890.3 1492.1 837.3 1498.9 807.3 1453.5 C 787.2 1423.3 792.5 1383.3 792.5 1348.4 C 782.5 1340.3 772.8 1331.8 763.6 1322.8 C 694.8 1257.1 655.5 1166.4 654.7 1071.3 C 652.8 969.4 692.0 871.1 763.5 798.6 C 832.1 727.8 922.7 690.9 1020.8 689.4 z M 865.7 1516.3 C 889.1 1515.7 915.0 1516.2 938.6 1516.1 L 1072.4 1515.9 L 1146.0 1516.0 C 1171.4 1516.0 1197.9 1512.9 1220.1 1527.2 C 1234 1536.0 1243.7 1549.9 1247.1 1565.9 C 1256.1 1609.6 1227.1 1640.6 1185.5 1647.8 C 1169.4 1649.4 1141.0 1648.7 1124 1648.7 L 1012.1 1648.6 L 916.5 1648.8 C 897.6 1648.8 879.4 1649.1 860.4 1647.6 C 832.4 1645.9 806.3 1620.2 803.3 1592.4 C 798.7 1549.2 823.5 1520.9 865.7 1516.3 z M 359.9 625.3 C 368.9 624.7 382.1 625.5 390.3 629.4 C 415.7 641.5 441.9 656.5 466.7 669.7 L 537.0 707.4 C 551.3 715.0 565.3 722.6 579.3 730.7 C 618.9 753.4 623.2 812.0 586.7 839.7 C 575.2 848.4 566.7 851.1 552.7 853.8 C 527.4 855.4 515.9 846.9 494.5 835.3 L 449.2 810.7 C 422.9 796.8 396.8 782.6 370.8 768.3 C 333.2 747.8 292.5 732.1 302.6 678.5 C 308.2 648.9 330.7 630.5 359.9 625.3 z M 1014.8 230.5 C 1056.4 223.8 1091.4 254.0 1091.9 295.9 C 1092.1 312.1 1092.1 328.3 1092.0 344.5 L 1092.0 430.0 L 1092.1 479.1 C 1092.2 485.6 1092.1 492.2 1092.2 498.7 C 1092.6 535.2 1065.6 564.5 1028.5 565.9 C 1015.2 565.7 1004.6 564.1 992.9 557.2 C 977.7 548.2 966.8 533.5 962.6 516.3 C 959.5 504.1 960.4 477.0 960.4 463.3 L 960.3 389.5 L 960.3 327.0 C 960.4 302.8 957.4 277.1 973.0 256.8 C 984.9 241.2 996.0 235.2 1014.8 230.5 z M 1677.3 625.2 C 1693.7 623.8 1708.2 626.3 1722.1 635.7 C 1736.5 645.4 1746.3 660.5 1749.4 677.5 C 1752.6 694.4 1749.6 712.1 1739.8 726.4 C 1735.1 733.5 1729.1 739.6 1722.2 744.4 C 1713.5 750.2 1700.6 756.8 1691.0 762.0 L 1636.7 791.3 L 1570.1 827.7 C 1552.2 837.4 1533.2 849.9 1513.3 853.7 C 1497.1 854.7 1482.8 852.1 1469.1 842.8 C 1453.9 832.5 1443.6 816.7 1440.3 798.7 C 1435.5 771.6 1448.7 744.9 1472.1 731.3 C 1483.8 724.6 1495.4 718.3 1507.3 711.9 L 1566.3 680.1 L 1623.6 649.1 C 1640.4 640.0 1658.3 628.2 1677.3 625.2 z M 640.1 345.3 C 664.9 344.0 686.9 352.1 700.8 374.0 C 737.0 431.2 772.2 489.4 807.0 547.5 C 810.2 552.9 814.9 565.2 815.8 571.3 C 818.3 589.1 813.5 607.0 802.5 621.2 C 790.4 636.6 775.5 643.5 756.4 646.0 C 732.1 646.7 709.8 638.8 696.5 617.6 C 660.2 559.9 624.2 501.3 589.0 442.9 C 569.2 410.1 587.4 363.4 622.4 349.9 C 628.7 347.5 633.4 346.5 640.1 345.3 z M 1397.5 345.3 C 1413.5 344.4 1427.3 347.2 1440.8 356.4 C 1455.3 366.0 1465.3 381.1 1468.7 398.2 C 1471.7 414.3 1469.7 430.4 1461.2 444.5 C 1426.8 501.5 1391.7 558.3 1356.4 614.9 C 1343.8 635.0 1330.8 641.5 1308.1 645.9 C 1291.1 646.4 1278.7 644.9 1264.1 635.2 C 1249.6 625.7 1239.6 610.7 1236.2 593.7 C 1230.1 563.1 1244.7 546.2 1259.7 521.5 C 1269.5 505.2 1279.4 489.0 1289.4 472.9 C 1309.2 440.7 1328.9 407.9 1349.2 375.9 C 1361.5 356.5 1375.5 349.5 1397.5 345.3 z M 951.6 1673.5 L 1106.6 1673.2 C 1128.9 1673.2 1147.1 1675.8 1163.5 1692.4 C 1175.9 1705 1182.8 1722.0 1182.6 1739.7 C 1182.1 1757.5 1174.7 1774.3 1161.8 1786.6 C 1144.1 1803.6 1126.3 1805.6 1103.2 1805.1 L 987.9 1805.2 C 979.6 1805.2 971.2 1805.3 962.9 1805.3 C 934.7 1805.4 911.3 1808.3 889.5 1786.9 C 876.4 1774.3 869.0 1757 868.9 1738.8 C 869.0 1721.3 876.0 1704.5 888.5 1692.2 C 907.4 1673.5 927.1 1673.4 951.6 1673.5 z' },
  allOff: { viewBox: '183 248 1659 1659', d: 'M 1461.7 512.6 C 1469.9 514.8 1500.1 567.9 1505.7 578.3 C 1568.9 698.4 1582.6 838.5 1543.8 968.5 C 1507.7 1087.7 1417.8 1210.5 1307.1 1270.0 C 1306.9 1300.5 1306.8 1330.9 1307.0 1361.4 C 1307.0 1411.2 1309.2 1455.7 1261.6 1486.5 C 1247.5 1495.6 1231.5 1501.4 1214.8 1503.2 C 1198.9 1505.1 1169.7 1504.4 1153.0 1504.4 L 1044.7 1504.3 L 918.1 1504.3 C 892.5 1504.4 854.7 1506.1 830.9 1501.1 C 809.3 1493.9 797.5 1489.5 780.9 1473.2 C 746.5 1439.5 751.1 1398.7 751.1 1355.0 L 750.9 1266.7 C 741.1 1261.6 732.7 1256.8 723.3 1251.2 C 751.2 1225.3 784.3 1190.2 811.6 1162.8 L 980.1 994.1 L 1461.7 512.6 z M 1004.7 283.4 C 1006.6 283.3 1008.6 283.3 1010.5 283.2 C 1124.3 280.1 1236.0 313.7 1329.2 379.0 C 1356.1 398.0 1378.6 417.7 1402.2 440.3 L 769.4 1073.3 C 729.1 1114.0 688.5 1154.5 647.6 1194.8 C 448.0 1002.7 441.8 666.5 628.5 465.4 C 732.2 353.7 851.9 291.5 1004.7 283.4 z M 823.5 1520.3 C 837.6 1518.7 873.3 1519.6 888.4 1519.7 L 1017.8 1519.7 L 1162.5 1519.6 C 1185.5 1519.6 1211.8 1518.4 1234.3 1520.3 C 1270.5 1523.3 1298.9 1554.8 1304.8 1588.8 C 1308.7 1610.9 1303.6 1633.7 1290.6 1652.0 C 1275.8 1672.7 1257.3 1681.9 1232.8 1686.0 C 1206.9 1687.3 1174.5 1686.4 1148.2 1686.5 L 989.1 1686.7 L 882.0 1686.4 C 852.9 1686.4 814.4 1690.6 790.0 1673.1 C 727.5 1628.3 745.5 1536.0 823.5 1520.3 z M 885.8 1704.4 C 946.5 1703.6 1008.3 1704.3 1069.1 1704.3 L 1133.2 1704.2 C 1144.4 1704.2 1159.6 1703.7 1170.3 1704.7 C 1178.8 1705.3 1187.0 1707.6 1194.6 1711.3 C 1234.9 1731.1 1246.0 1783.2 1226.8 1821.6 C 1215.5 1844.1 1194.2 1860.4 1170.5 1868.2 C 1167.4 1869.0 1164.2 1869.7 1160.9 1870.3 C 1147.1 1872.9 1123.1 1872.1 1108.1 1872.0 L 1030.9 1871.9 L 948.2 1872.1 C 917.1 1872.2 888.3 1875.7 861.3 1857.0 C 841.4 1843.1 827.8 1822.0 823.4 1798.1 C 815.6 1754.1 840.1 1711.7 885.8 1704.4 z' },
};

export function icon(name, size = 18, stroke = 1.8) {
  if (FILLED[name]) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', FILLED[name].viewBox);
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    el.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', FILLED[name].d);
    path.setAttribute('fill', 'currentColor');
    if (FILLED[name].rule) path.setAttribute('fill-rule', FILLED[name].rule);
    el.append(path);
    el.classList.add('icon');
    return el;
  }
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
