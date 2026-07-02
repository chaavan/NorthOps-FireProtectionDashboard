import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password-reset-request
 * Create a password reset request (public endpoint)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email: rawEmail, newPassword } = body;

    if (!rawEmail || !newPassword) {
      return NextResponse.json(
        { error: 'Email and new password are required' },
        { status: 400 }
      );
    }

    // Validate password length
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();

    // Check if user with this email exists (case-insensitive)
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'No account found with this email address' },
        { status: 404 }
      );
    }

    // Check if there's already a pending request for this email
    const existingRequest = await prisma.passwordResetRequest.findFirst({
      where: {
        email: {
          equals: user.email,
          mode: 'insensitive',
        },
        status: 'pending',
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: 'A password reset request is already pending for this email. Please wait for admin approval or contact support.' },
        { status: 400 }
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Create the password reset request
    await prisma.passwordResetRequest.create({
      data: {
        email: user.email,
        hashedPassword,
        status: 'pending',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset request submitted successfully. An administrator will review your request.',
    });
  } catch (error) {
    console.error('Error creating password reset request:', error);
    return NextResponse.json(
      { error: 'Failed to create password reset request' },
      { status: 500 }
    );
  }
}

