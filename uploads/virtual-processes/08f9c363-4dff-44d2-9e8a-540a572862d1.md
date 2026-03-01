# File Tree: SIMP-BACKEND

**Generated:** 3/1/2026, 12:35:47 PM
**Root Path:** `d:\PROJECTS\SIMP-BACKEND`

```
├── 📁 .github
│   └── 📁 workflows
│       └── ⚙️ ci.yml
├── 📁 certs
│   └── 📁 users
│       └── 📄 Wpaj5Z-8yiO2XenRQqWcG.pfx
├── 📁 docker
│   └── 📁 postgres
│       └── 📁 init.sql
├── 📁 notes
│   └── 📝 dev_notes_24012026.md
├── 📁 prisma
│   ├── 📁 migrations
│   │   ├── 📁 20260131112718_init_full_schema
│   │   │   └── 📄 migration.sql
│   │   ├── 📁 20260205005906_init_communication
│   │   │   └── 📄 migration.sql
│   │   ├── 📁 20260205010615_add_updated_at_fix
│   │   │   └── 📄 migration.sql
│   │   ├── 📁 20260205020827_add_document_number
│   │   │   └── 📄 migration.sql
│   │   ├── 📁 20260207200320_add_communication_attachments
│   │   │   └── 📄 migration.sql
│   │   ├── 📁 20260217143436_add_job_title
│   │   │   └── 📄 migration.sql
│   │   └── ⚙️ migration_lock.toml
│   ├── 📁 seeds
│   │   ├── 📄 seed.d.ts
│   │   ├── 📄 seed.js
│   │   └── 📄 seed.ts
│   └── 📄 schema.prisma
├── 📁 public
├── 📁 scripts
│   ├── 📄 debug_audit.ts
│   ├── 📄 debug_create_500.ts
│   ├── 📄 reproduce_swagger.ts
│   ├── 📄 setup.sh
│   ├── 📄 test_audit_trail.ts
│   ├── 📄 test_conn.ts
│   ├── 📄 test_download.ts
│   ├── 📄 test_full_workflow.ts
│   ├── 📄 test_login.ts
│   ├── 📄 test_verification_stamp.ts
│   ├── 📄 verification_final.ts
│   ├── 📄 verify-logo-loading.ts
│   ├── 📄 verify_customization.ts
│   ├── 📄 verify_recipients_fix.ts
│   ├── 📄 verify_services.ts
│   └── 📄 verify_tracking.ts
├── 📁 src
│   ├── 📁 config
│   │   ├── 📄 config.ts
│   │   ├── 📄 plugins.ts
│   │   └── 📄 routes.ts
│   ├── 📁 controllers
│   │   ├── 📄 auth.controller.ts
│   │   ├── 📄 communication.controller.ts
│   │   ├── 📄 finance-category.controller.ts
│   │   ├── 📄 finance-entry.controller.ts
│   │   ├── 📄 notification.controller.ts
│   │   ├── 📄 public.controller.ts
│   │   ├── 📄 role.controller.ts
│   │   ├── 📄 settings.controller.ts
│   │   ├── 📄 task.controller.ts
│   │   ├── 📄 upload.controller.ts
│   │   ├── 📄 user.controller.ts
│   │   └── 📄 workspace.controller.ts
│   ├── 📁 lib
│   │   └── 📄 prisma.ts
│   ├── 📁 middleware
│   │   └── 📄 auth.middleware.ts
│   ├── 📁 modules
│   ├── 📁 routes
│   │   ├── 📄 auth.routes.ts
│   │   ├── 📄 communication.routes.ts
│   │   ├── 📄 finance.routes.ts
│   │   ├── 📄 notification.routes.ts
│   │   ├── 📄 public.routes.ts
│   │   ├── 📄 role.routes.ts
│   │   ├── 📄 settings.routes.ts
│   │   ├── 📄 task.routes.ts
│   │   ├── 📄 upload.routes.ts
│   │   ├── 📄 user.routes.ts
│   │   └── 📄 workspace.routes.ts
│   ├── 📁 schemas
│   │   ├── 📄 auth.schemas.ts
│   │   ├── 📄 communication.schemas.ts
│   │   ├── 📄 finance.schema.ts
│   │   ├── 📄 task.schemas.ts
│   │   └── 📄 workspace.schemas.ts
│   ├── 📁 services
│   │   ├── 📄 audit.service.ts
│   │   ├── 📄 auth.service.ts
│   │   ├── 📄 certificate.service.ts
│   │   ├── 📄 document.generator.ts
│   │   ├── 📄 document.service.ts
│   │   ├── 📄 document.service_helper.ts
│   │   ├── 📄 email.service.ts
│   │   ├── 📄 notification.service.ts
│   │   ├── 📄 pdf.service.ts
│   │   ├── 📄 protocol.service.ts
│   │   └── 📄 signature.service.ts
│   ├── 📁 templates
│   │   ├── 📁 assets
│   │   └── 📁 docx
│   │       ├── 🖼️ logo_pequizeiro.png
│   │       └── 📘 template_oficio.dcx.docx
│   ├── 📁 test
│   │   ├── 📄 auth_db.spec.ts
│   │   └── 📄 example.spec.ts
│   ├── 📁 types
│   │   ├── 📄 fastify-jwt.d.ts
│   │   ├── 📄 fastify.d.ts
│   │   └── 📄 server.ts
│   ├── 📁 utils
│   │   ├── 📄 database.ts
│   │   ├── 📄 graceful-shutdown.ts
│   │   ├── 📄 logger.ts
│   │   ├── 📄 pdf.utils.ts
│   │   └── 📄 redis.ts
│   └── 📄 index.ts
├── 📁 tests
│   ├── 📄 setup.d.ts
│   ├── 📄 setup.js
│   └── 📄 setup.ts
├── 📁 uploads
│   ├── 📕 05a82c186d8b885c7de3642858975e7f.pdf
│   ├── 🖼️ 1770822613230-b1b2cbaf2393be35.png
│   ├── 📘 1772207890438-8173d60cccef08a7.docx
│   ├── 📕 21e9b2f3203fc438b15c6dbaccdbf2e8.pdf
│   ├── 📕 371e8374cbae3a811a7b37f8a14ccc7f.pdf
│   ├── 🖼️ 39a505bd9c22a85d5c8ef91d939df854.jpg
│   ├── 📕 3e04bfba21391516bbd76e184f397fa0.pdf
│   ├── 📕 43b251f03330c142482d4f2d879a37f3.pdf
│   ├── 📕 4f6e83243829f5ffa5bab159ab943b46.pdf
│   ├── 🖼️ 51cda0ccaf276e4f6e38e9a0174c8085.jpeg
│   ├── 🖼️ 54c02a23d258c24219bd5767e834bcee.jpeg
│   ├── 📕 5ad274f4472ac0df89e5a2fca4e5d52a.pdf
│   ├── 🖼️ 658fc7bc28a9119dfa5a49c2debeafd7.jpeg
│   ├── 📕 7c7a55b0a0caa24ddad49383121c82b1.pdf
│   ├── 📕 9bdf09ab86c51cef27d59f67acf1cde2.pdf
│   ├── 📕 OFICIO_202602140001.pdf
│   ├── 📕 OFICIO_202602140002.pdf
│   ├── 📕 OFICIO_202602140003.pdf
│   ├── 📕 OFICIO_202602140004.pdf
│   ├── 📕 OFICIO_202602140005.pdf
│   ├── 📕 OFICIO_202602140006.pdf
│   ├── 📕 OFICIO_202602160001.pdf
│   ├── 📕 OFICIO_202602160002.pdf
│   ├── 📕 OFICIO_202602160003.pdf
│   ├── 📕 OFICIO_202602160004.pdf
│   ├── 📕 OFICIO_202602170001.pdf
│   ├── 📕 OFICIO_202602170002.pdf
│   ├── 📕 OFICIO_202602170003.pdf
│   ├── 📕 OFICIO_202602170004.pdf
│   ├── 📕 OFICIO_202602230001.pdf
│   ├── 📕 OFICIO_202602230002.pdf
│   ├── 📕 OFICIO_202602230003.pdf
│   ├── 📕 OFICIO_202602230004.pdf
│   ├── 📕 OFICIO_202602230005.pdf
│   ├── 📕 OFICIO_202602250002.pdf
│   ├── 📕 OFICIO_202602250003.pdf
│   ├── 📕 OFICIO_202602250004.pdf
│   ├── 📕 OFICIO_202602270001.pdf
│   ├── 📕 ace40dcd8e23c3fa034ff060a8c968b3.pdf
│   ├── 📕 ae161246ad003678f6c1c6699329741e.pdf
│   ├── 📘 b9f3e287361809b1bdea886e6098cfa4.docx
│   ├── 🖼️ bdd70ec31fbbc0cbff122334da876258.jpeg
│   ├── 🖼️ c5eba12d290f9bca4969ced3458d082a.jpg
│   ├── 📕 c6b66459f02043bf2c93f5edc41a66c5.pdf
│   ├── 📕 d7e81935440a94138242973a2ecba28a.pdf
│   ├── 📕 dde17893b604fdfad0ca4038712970da.pdf
│   ├── 🖼️ e1d6670b2b7bf8d2d5bd410c9b30eb2f.jpeg
│   ├── ⚙️ f414ca99c7398ce43f44a42b209a8cb3.exe
│   ├── 📕 f76ba44ff3d95e534a073092cb05cdc1.pdf
│   ├── 📕 fgts.pdf
│   └── 📘 orçamento.docx
├── ⚙️ .env.example
├── ⚙️ .gitignore
├── ⚙️ .nvmrc
├── ⚙️ .prettierrc
├── 📝 BACKEND.md
├── 🐳 Dockerfile
├── 📝 README.md
├── ⚙️ docker-compose.yml
├── 📄 eslint.config.js
├── ⚙️ package-lock.json
├── ⚙️ package.json
├── 📦 simp-backend.zip
├── ⚙️ tsconfig.json
├── 📄 verification_result.txt
├── 📄 verify_output.txt
├── 📄 verify_output_2.txt
└── 📄 vitest.config.ts
```

---
*Generated by FileTree Pro Extension*