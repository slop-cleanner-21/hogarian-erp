import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ingresar" };

export default function Layout({ children }: LayoutProps<"/login">) {
  return children;
}
