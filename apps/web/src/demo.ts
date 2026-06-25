// The demo is scoped by ROOM — the plugin's `referenceId` IS the room id.
// Everyone in the same room shares the same counters + realtime; rooms are
// isolated. Switching rooms = `setReference(room)` (join), nothing global,
// no billing plan. This showcases room-scoped realtime.
export const ROOMS = ["lobby", "alpha", "beta"] as const
export type Room = (typeof ROOMS)[number]

export const DEFAULT_ROOM: Room = "lobby"
export const REFERENCE_TYPE = "room"
