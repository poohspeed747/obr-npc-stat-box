import OBR from "@owlbear-rodeo/sdk";
import { listenForRolls } from "./dice.js";

OBR.onReady(async () => {
  // Runs in the background for every player so roll notifications show up
  // no matter what panel someone currently has open.
  listenForRolls();
});