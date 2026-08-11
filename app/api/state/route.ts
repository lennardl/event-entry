import { getState } from "../../../lib/store";

export async function GET() {
  try {
    return Response.json(await getState());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load state" }, { status: 500 });
  }
}
