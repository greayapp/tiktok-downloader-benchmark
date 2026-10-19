// MusicalDown: a photo post's images each have a plain "DOWNLOAD" button (a tokenised link) under
// a "Download Photos" heading; on a video result no button is labelled just "DOWNLOAD".
import { TASK_LABELS } from "../generic.mjs";

export default {
    controls: {
        photos: [TASK_LABELS.photos[0], /^download$/i, ...TASK_LABELS.photos.slice(1)],
    },
};
