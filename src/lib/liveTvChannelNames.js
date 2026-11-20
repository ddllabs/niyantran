// The real names of the Live TV channels, for screens that only hold a channel id (the usage screen).
// The 83 added channels come straight from the server catalogue (plain data, no server code). The 13 curated
// channels are defined in server/liveTvApi.mjs, which holds server code the browser must not load, so their
// names are repeated here; liveTvChannelNames.test.js fails if either side drifts.
import { ADDED_CHANNELS } from '../../server/liveTvChannels.mjs';

export const CURATED_CHANNEL_NAMES = {
  'dhruv-rathee': 'Dhruv Rathee',
  'think-school': 'Think School',
  'khan-gs': 'Khan GS Research Centre',
  'soch-mohak': 'Soch by Mohak Mangal',
  'csis': 'CSIS',
  'dd-news': 'DD News',
  'sansad-tv': 'Sansad TV',
  'wion': 'WION',
  'ndtv-24x7': 'NDTV 24x7',
  'cnbc-tv18': 'CNBC-TV18',
  'et-now': 'ET Now',
  'india-today': 'India Today TV',
  'aaj-tak': 'Aaj Tak',
};

const NAMES = new Map([
  ...Object.entries(CURATED_CHANNEL_NAMES),
  ...ADDED_CHANNELS.map((c) => [c.id, c.name]),
]);

/** The catalogue name of a channel id, or '' when the id is not a Live TV channel. */
export function catalogueChannelName(id) {
  return NAMES.get(String(id || '')) || '';
}
