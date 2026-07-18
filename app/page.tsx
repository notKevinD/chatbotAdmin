import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import AdminApp from "./admin-app";

export default async function HomePage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  return <AdminApp />;
}