import { bootstrapLyra } from "./bootstrap";
import { detectCurrentRuntime } from "./services/runtime";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element was not found");

void bootstrapLyra(root, detectCurrentRuntime());
