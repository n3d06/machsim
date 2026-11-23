import { createElement as h } from 'react';
import {
  Pause, Play, RotateCcw, RotateCw, Undo2, Redo2, Settings, CircleHelp, SunMoon, FilePlus, FolderOpen, Save, Share2,
  ChevronDown, MousePointer2, Cable, ArrowRight, Minus, Plus, Maximize, Trash2, FlipVertical2, ChartLine,
  ArrowLeftRight, PanelLeft, PanelRight, Eraser
} from 'lucide';

const ICONS = { Pause, Play, RotateCcw, RotateCw, Undo2, Redo2, Settings, CircleHelp, SunMoon, FilePlus, FolderOpen, Save, Share2,
  ChevronDown, MousePointer2, Cable, ArrowRight, Minus, Plus, Maximize, Trash2, FlipVertical2, ChartLine, ArrowLeftRight, PanelLeft, PanelRight, Eraser };

// Cho React
export const Icon = ({ n, size = 16 }) => h('svg', {
  xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'ic', 'aria-hidden': true
}, ICONS[n].map(([tag, attrs], i) => h(tag, { key: i, ...attrs })));

// Cho lõi cũ (js/app.js, js/breadboard.js) vốn gán innerHTML: MS.icon('Play') → chuỗi SVG
(window.MS = window.MS || {}).icon = (n, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ic" aria-hidden="true">` +
  ICONS[n].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('') + '</svg>';
