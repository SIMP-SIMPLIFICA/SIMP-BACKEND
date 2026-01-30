-- CreateTable
CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "numeroConvenio" TEXT,
    "objeto" TEXT NOT NULL,
    "valorGlobal" DECIMAL(15,2) NOT NULL,
    "valorRepasse" DECIMAL(15,2) NOT NULL,
    "valorContrapartida" DECIMAL(15,2) NOT NULL,
    "dataInicio" TIMESTAMP(3),
    "dataFim" TIMESTAMP(3),
    "situacao" TEXT NOT NULL,
    "orgaoConcedente" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grant_notes" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grants_externalId_key" ON "grants"("externalId");

-- AddForeignKey
ALTER TABLE "grant_notes" ADD CONSTRAINT "grant_notes_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grant_notes" ADD CONSTRAINT "grant_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
