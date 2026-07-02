import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/approve-password-reset
 * Approve a password reset request (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin permission
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const auth = await requirePermission(session, 'users.password_resets.manage');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { requestId } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: 'requestId is required' },
        { status: 400 }
      );
    }

    // Get the password reset request
    const resetRequest = await prisma.passwordResetRequest.findUnique({
      where: { id: requestId },
    });

    if (!resetRequest) {
      return NextResponse.json(
        { error: 'Password reset request not found' },
        { status: 404 }
      );
    }

    if (resetRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'This password reset request has already been processed' },
        { status: 400 }
      );
    }

    // Get the user (case-insensitive — stored emails may differ in casing)
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: resetRequest.email,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Update user's password with the hashed password from the request
    await prisma.user.update({
      where: { id: user.id },
      data: { password: resetRequest.hashedPassword },
    });

    // Delete the password reset request
    await prisma.passwordResetRequest.delete({
      where: { id: requestId },
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset request approved successfully',
    });
  } catch (error) {
    console.error('Error approving password reset request:', error);
    return NextResponse.json(
      { error: 'Failed to approve password reset request' },
      { status: 500 }
    );
  }
}

