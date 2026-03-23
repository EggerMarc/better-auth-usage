// Legacy export — tests import shutdownUsage from here.
// The actual runtime is now in package/runtime.ts.
import { resetRuntime } from "@/runtime"

export async function shutdownUsage() {
    resetRuntime()
}
