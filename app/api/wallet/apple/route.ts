export async function GET() {
  return Response.json({ message: "Apple Wallet signing credentials are required for a production pass. The mobile ticket remains available offline through the installed web app." }, { status: 501 });
}
