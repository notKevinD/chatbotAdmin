import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/");
  return <LoginForm />;
}
