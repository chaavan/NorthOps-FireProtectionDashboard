import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
// GET /api/calendar/events?id=...
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    const start = request.nextUrl.searchParams.get('start');
    const end = request.nextUrl.searchParams.get('end');

    if (id) {
      const event = await prisma.calendarEvent.findUnique({ where: { id } });
      return NextResponse.json({ events: event ? [event] : [] });
    }

    const where: {
      date?: {
        gte?: Date;
        lte?: Date;
      };
    } = {};

    if (start || end) {
      where.date = {};
      if (start) where.date.gte = new Date(`${start}T00:00:00.000`);
      if (end) where.date.lte = new Date(`${end}T23:59:59.999`);
    }

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error in /api/calendar/events GET:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/calendar/events
// Body: { title: string, date: string (YYYY-MM-DD), notes?: string }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const body = await request.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const dateInput = typeof body?.date === 'string' ? body.date.trim() : '';
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : null;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!dateInput) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    const date = new Date(`${dateInput}T12:00:00.000`);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const createdBy = ((session.user as any).name || (session.user as any).email || null) as string | null;

    const event = await prisma.calendarEvent.create({
      data: {
        title,
        date,
        notes,
        createdBy,
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error('Error in /api/calendar/events POST:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE /api/calendar/events?id=...
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await prisma.calendarEvent.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in /api/calendar/events DELETE:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

