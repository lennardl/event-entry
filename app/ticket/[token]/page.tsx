import { CitizenTicket } from "../../ui/CitizenTicket";

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CitizenTicket token={token} />;
}
