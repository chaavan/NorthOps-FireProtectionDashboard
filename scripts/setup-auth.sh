#!/bin/bash

echo "🔐 Setting up Authentication System..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from ENV_EXAMPLE.txt..."
    cp ENV_EXAMPLE.txt .env
    echo "✅ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your DATABASE_URL and NEXTAUTH_SECRET"
    echo ""
fi

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
npx prisma generate

# Push schema to database
echo ""
echo "🗄️  Pushing schema to database..."
echo "⚠️  Make sure your DATABASE_URL is set in .env"
read -p "Press Enter to continue or Ctrl+C to cancel..."
npx prisma db push

# Create admin user
echo ""
echo "👤 Creating admin user..."
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const name = process.env.ADMIN_NAME || 'Admin User';

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log('✅ Admin user already exists');
      console.log('📧 Email:', email);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    });

    console.log('✅ Admin user created successfully!');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('⚠️  CHANGE THIS PASSWORD AFTER FIRST LOGIN!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.\$disconnect();
  }
}

createAdmin();
"

echo ""
echo "✅ Authentication setup complete!"
echo ""
echo "Next steps:"
echo "1. Start your dev server: npm run dev"
echo "2. Visit http://localhost:3000"
echo "3. Sign in with your admin credentials"
echo "4. Change your password!"
echo ""

