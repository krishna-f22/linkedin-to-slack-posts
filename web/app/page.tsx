import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import ResearchDashboard from "@/components/ResearchDashboard";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  return <ResearchDashboard userEmail={data.user.email ?? ""} />;
}
