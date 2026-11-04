import {createApp} from "../server/app.js";
import {cloudDemo} from "../server/cloud-demo.js";
export default cloudDemo(origin => createApp("", origin, true));
