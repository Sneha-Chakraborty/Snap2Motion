export type CameraMove =
  | "static"
  | "push_in"
  | "pull_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "truck_left"
  | "truck_right"
  | "pedestal_up"
  | "pedestal_down"
  | "zoom_in"
  | "zoom_out"
  | "tracking"
  | "shake";

export const CAMERA_MOVE_LABELS: Record<CameraMove, string> = {
  static: "Static shot",
  push_in: "Push in",
  pull_out: "Pull out",
  pan_left: "Pan left",
  pan_right: "Pan right",
  tilt_up: "Tilt up",
  tilt_down: "Tilt down",
  truck_left: "Truck left",
  truck_right: "Truck right",
  pedestal_up: "Pedestal up",
  pedestal_down: "Pedestal down",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  tracking: "Tracking shot",
  shake: "Shake",
};

export function cameraMoveToBracket(move: CameraMove): string {
  switch (move) {
    case "static": return "[Static shot]";
    case "push_in": return "[Push in]";
    case "pull_out": return "[Pull out]";
    case "pan_left": return "[Pan left]";
    case "pan_right": return "[Pan right]";
    case "tilt_up": return "[Tilt up]";
    case "tilt_down": return "[Tilt down]";
    case "truck_left": return "[Truck left]";
    case "truck_right": return "[Truck right]";
    case "pedestal_up": return "[Pedestal up]";
    case "pedestal_down": return "[Pedestal down]";
    case "zoom_in": return "[Zoom in]";
    case "zoom_out": return "[Zoom out]";
    case "tracking": return "[Tracking shot]";
    case "shake": return "[Shake]";
  }
}

export type VisualStyle = "cinematic" | "realistic" | "anime" | "dreamy" | "retro";

export const STYLE_HINTS: Record<VisualStyle, string> = {
  cinematic: "cinematic lighting, film look, shallow depth of field",
  realistic: "photorealistic, natural lighting, realistic motion",
  anime: "anime style, vibrant colors, clean line art",
  dreamy: "soft dreamy atmosphere, bokeh, gentle glow",
  retro: "retro 90s vibe, film grain, muted palette",
};

/**
 * A tiny “agent” that massages the user’s prompt into a more
 * video-friendly prompt without calling an LLM.
 */
export function buildDirectorPrompt(args: {
  userPrompt: string;
  camera: CameraMove;
  durationSec: number;
  style: VisualStyle;
  motionIntensity: "subtle" | "medium" | "strong";
}): string {
  const { userPrompt, camera, durationSec, style, motionIntensity } = args;

  const bracket = cameraMoveToBracket(camera);

  const intensityHint =
    motionIntensity === "subtle"
      ? "subtle motion"
      : motionIntensity === "medium"
      ? "smooth motion"
      : "dynamic motion";

  // Put camera movement first (works well with “director” style models).
  // Mention duration explicitly so even models without a dedicated duration input can follow it.
  const dur = Math.max(2, Math.min(6, Math.round(durationSec)));

  return `${bracket} ${userPrompt}. ${STYLE_HINTS[style]}. ${intensityHint}. ${dur}-second shot.`;
}
