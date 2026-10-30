// Lazy, additive Design Department schema. Existing installations create only
// these three tables on the first granted Design request; the Windows
// installer creates the same tables for a fresh PC. Keep in sync with
// src/db/schema.ts and installer/schema.sql.
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

export async function ensureDesignSchema(): Promise<void> {
  if (ready) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221910)`);
    await tx.execute(sql`
      create table if not exists design_drawings (
        id serial primary key,
        drawing_no text not null,
        revision text not null,
        title text not null,
        project_name text not null default '',
        client_name text not null default '',
        architect_name text not null default '',
        order_id integer references orders(id) on delete set null,
        order_snapshot text not null default '',
        discipline text not null default 'General Joinery',
        area text not null default '',
        sheet_count integer not null default 1 check (sheet_count between 1 and 1000),
        status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Returned', 'Issued to Production', 'On Hold', 'Superseded', 'Cancelled')),
        priority text not null default 'Normal' check (priority in ('Normal', 'High', 'Urgent')),
        required_date date,
        external_link text not null default '',
        notes text not null default '',
        submitted_to text not null default '',
        submitted_by_id integer references users(id) on delete set null,
        submitted_date date,
        transmittal_no text not null default '',
        response_due_date date,
        approval_code text not null default '' check (approval_code in ('', 'A', 'B', 'C', 'D')),
        approval_by text not null default '',
        approval_date date,
        approval_comments text not null default '',
        comments_incorporated boolean not null default false,
        comments_incorporated_by_id integer references users(id) on delete set null,
        comments_incorporated_at timestamp,
        issued_to text not null default '',
        issued_by_id integer references users(id) on delete set null,
        issued_at timestamp,
        issue_note text not null default '',
        supersedes_id integer references design_drawings(id) on delete set null,
        created_by_id integer references users(id) on delete set null,
        updated_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now(),
        updated_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create unique index if not exists design_drawings_project_drawing_revision_unique_idx on design_drawings (lower(project_name), lower(drawing_no), lower(revision))`);
    await tx.execute(sql`create index if not exists design_drawings_status_idx on design_drawings (status)`);
    await tx.execute(sql`create index if not exists design_drawings_approval_code_idx on design_drawings (approval_code)`);
    await tx.execute(sql`create index if not exists design_drawings_order_idx on design_drawings (order_id)`);
    await tx.execute(sql`create index if not exists design_drawings_drawing_no_idx on design_drawings (drawing_no)`);
    await tx.execute(sql`create index if not exists design_drawings_updated_at_idx on design_drawings (updated_at)`);
    await tx.execute(sql`
      create table if not exists design_drawing_events (
        id serial primary key,
        drawing_id integer not null references design_drawings(id) on delete cascade,
        event_type text not null,
        summary text not null,
        details text not null default '',
        revision_snapshot text not null default '',
        status_snapshot text not null default '',
        approval_code text not null default '' check (approval_code in ('', 'A', 'B', 'C', 'D')),
        actor_id integer references users(id) on delete set null,
        actor_name text not null default '',
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists design_drawing_events_drawing_idx on design_drawing_events (drawing_id)`);
    await tx.execute(sql`create index if not exists design_drawing_events_created_at_idx on design_drawing_events (created_at)`);
    await tx.execute(sql`
      create table if not exists design_drawing_files (
        id serial primary key,
        drawing_id integer not null references design_drawings(id) on delete cascade,
        kind text not null default 'Drawing PDF/CAD',
        file_name text not null,
        original_name text not null default '',
        mime text not null default '',
        size integer not null default 0 check (size >= 0),
        uploaded_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists design_drawing_files_drawing_idx on design_drawing_files (drawing_id)`);
  });
  ready = true;
}
