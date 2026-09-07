import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { asc } from "drizzle-orm";
import { authorize, hashPin } from "@/lib/auth";

export async function GET() {
  const { error: authError } = await authorize("users:read");
  if (authError) return authError;

  try {
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatarColor: users.avatarColor,
        active: users.active,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.role), asc(users.name));
    return NextResponse.json(allUsers);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch users";
    console.error("GET users error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("users:manage");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, email, role = "Machine Operator", avatarColor = "bg-amber-600", pin = "1234" } = body;
    if (!name || !email || !/^\d{4}$/.test(String(pin))) {
      return NextResponse.json({ error: "Name, email, and a four-digit PIN are required." }, { status: 400 });
    }

    const [newUser] = await db.insert(users).values({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role,
      avatarColor,
      pin: await hashPin(String(pin)),
      active: true,
    }).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarColor: users.avatarColor,
      active: users.active,
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    console.error("POST user error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
