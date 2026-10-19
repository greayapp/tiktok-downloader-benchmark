// TTSave: the link box isn't in a form; its "Search" button submits.
import { clickLikeUser } from "../flow.mjs";

export default {
    async submit(page, input, mobile) {
        const button = await page.$("#tktdl-search");
        if (!(await clickLikeUser(page, button, mobile))) await input.press("Enter");
    },
};
