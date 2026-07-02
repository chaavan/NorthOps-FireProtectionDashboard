import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/reject-password-reset
 * Reject/delete a password reset request (admin only)
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

    // Check if the request exists
    const resetRequest = await prisma.passwordResetRequest.findUnique({
      where: { id: requestId },
    });

    if (!resetRequest) {
      return NextResponse.json(
        { error: 'Password reset request not found' },
        { status: 404 }
      );
    }

    // Delete the password reset request
    await prisma.passwordResetRequest.delete({
      where: { id: requestId },
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset request rejected successfully',
    });
  } catch (error) {
    console.error('Error rejecting password reset request:', error);
    return NextResponse.json(
      { error: 'Failed to reject password reset request' },
      { status: 500 }
    );
  }
}

