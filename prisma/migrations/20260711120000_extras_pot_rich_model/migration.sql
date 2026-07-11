-- AlterTable
ALTER TABLE "ExtrasDeclaration" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "ExtrasDeclaration" ADD COLUMN "receiptUrl" TEXT;
ALTER TABLE "ExtrasDeclaration" ADD COLUMN "allocation" TEXT;
ALTER TABLE "ExtrasDeclaration" ADD COLUMN "shares" TEXT;