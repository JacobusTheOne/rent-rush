"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";

// Static export: everything runs in the browser, so no { ssr: true }.
Amplify.configure(outputs);

/** Single shared data client (created once, at module scope). */
export const client = generateClient<Schema>();
