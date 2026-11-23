import PanelMap from './PanelMap.jsx';
import StageTimeline from './StageTimeline.jsx';
import ValueBoard from './ValueBoard.jsx';

/**
 * The visual types a record panel can draw (F121). The supervisor owns this registry: a batch that
 * needs a new visual adds its component file, and the supervisor registers it here and in
 * VISUAL_TYPES (modelContract rejects any other type, so nothing is silently dropped).
 */
export const VISUALS = { map: PanelMap, timeline: StageTimeline, board: ValueBoard };
