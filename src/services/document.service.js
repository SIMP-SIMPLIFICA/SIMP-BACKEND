"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentService = exports.DocumentService = void 0;
var prisma_1 = require("@/lib/prisma");
var protocol_service_1 = require("./protocol.service");
var audit_service_1 = require("./audit.service");
var pdf_service_1 = require("./pdf.service");
var signature_service_1 = require("./signature.service");
var pdf_utils_1 = require("../utils/pdf.utils");
var node_crypto_1 = __importDefault(require("node:crypto"));
var node_fs_1 = __importDefault(require("node:fs"));
var node_path_1 = __importDefault(require("node:path"));
var node_url_1 = require("node:url");
var __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
var __dirname = node_path_1.default.dirname(__filename);
var DocumentService = /** @class */ (function () {
    function DocumentService() {
    }
    /**
     * Executa o fluxo completo de "Protocolar e Enviar"
     */
    DocumentService.prototype.protocolAndSend = function (documentId, userId) {
        return __awaiter(this, void 0, void 0, function () {
            var document, protocolNumber, dataToHash, originalHash, now, historico, recipientUser, creatorMeta, creatorLogoBase64, docTypeLabel, typeLabel, docRef, pdfData, pdfBuffer, finalPdf, certPath, pfxBuffer, e_1, uploadDir, docTypeAbbrev, filePrefix, fileName, filePath;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0: return [4 /*yield*/, prisma_1.prisma.communicationDocument.findUnique({
                            where: { id: documentId },
                            include: {
                                creator: { include: { department: true } },
                                recipients: { include: { user: true } },
                                signatures: true
                            }
                        })];
                    case 1:
                        document = _e.sent();
                        if (!document)
                            throw new Error('Documento não encontrado');
                        if (document.status !== 'DRAFT')
                            throw new Error('Documento já enviado');
                        return [4 /*yield*/, protocol_service_1.ProtocolService.generate()
                            // 2. Hash Original (Conteúdo + Metadados Essenciais)
                        ];
                    case 2:
                        protocolNumber = _e.sent();
                        dataToHash = "".concat(protocolNumber, "|").concat(document.title, "|").concat(document.content, "|").concat(userId, "|").concat(new Date().toISOString());
                        originalHash = node_crypto_1.default.createHash('sha256').update(dataToHash).digest('hex');
                        // 3. Log de Auditoria Inicial (SENT)
                        return [4 /*yield*/, audit_service_1.AuditService.log({
                                userId: userId,
                                action: 'PROTOCOL_GENERATED',
                                resource: 'DOCUMENT',
                                resourceId: documentId,
                                metadata: { protocol: protocolNumber, hash: originalHash }
                            })];
                    case 3:
                        // 3. Log de Auditoria Inicial (SENT)
                        _e.sent();
                        now = new Date();
                        // Atualiza status básico
                        return [4 /*yield*/, prisma_1.prisma.communicationDocument.update({
                                where: { id: documentId },
                                data: {
                                    protocolNumber: protocolNumber,
                                    originalHash: originalHash,
                                    status: 'SENT',
                                    sentAt: now
                                }
                            })
                            // Bypass de PDF para MENSAGEM (não gera PDF, não assina, não gera anexos)
                        ];
                    case 4:
                        // Atualiza status básico
                        _e.sent();
                        // Bypass de PDF para MENSAGEM (não gera PDF, não assina, não gera anexos)
                        if (document.documentType === 'MENSAGEM') {
                            return [2 /*return*/, { protocol: protocolNumber, hash: originalHash }];
                        }
                        return [4 /*yield*/, audit_service_1.AuditService.getDocumentHistory(documentId)
                            // Prepara dados para PDF
                        ];
                    case 5:
                        historico = _e.sent();
                        recipientUser = (_a = document.recipients[0]) === null || _a === void 0 ? void 0 : _a.user;
                        creatorMeta = (_b = document.creator) === null || _b === void 0 ? void 0 : _b.metadata;
                        creatorLogoBase64 = (0, pdf_utils_1.loadLogoFromPath)(creatorMeta === null || creatorMeta === void 0 ? void 0 : creatorMeta.logoUrl);
                        docTypeLabel = {
                            OFICIO: 'OFÍCIO', MEMORANDO: 'MEMORANDO', OFICIO_CIRCULAR: 'OFÍCIO CIRCULAR',
                            DECRETO: 'DECRETO', PORTARIA: 'PORTARIA', REQUERIMENTO: 'REQUERIMENTO', MENSAGEM: 'MENSAGEM'
                        };
                        typeLabel = docTypeLabel[document.documentType] || document.documentType;
                        docRef = document.documentNumber || protocolNumber;
                        pdfData = {
                            numero_oficio: "".concat(typeLabel, " N\u00BA ").concat(docRef),
                            data_extenso: now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
                            nome_destinatario: recipientUser ? "".concat(recipientUser.firstName, " ").concat(recipientUser.lastName) : "A QUEM INTERESSAR POSSA",
                            cargo_destinatario: (recipientUser === null || recipientUser === void 0 ? void 0 : recipientUser.jobTitle) || "Cargo não informado",
                            assunto: document.title,
                            lista_paragrafos: [{ texto: document.content }],
                            nome_remetente: "".concat(document.creator.firstName, " ").concat(document.creator.lastName),
                            cargo_remetente: [
                                document.creator.jobTitle,
                                (_c = document.creator.department) === null || _c === void 0 ? void 0 : _c.name
                            ].filter(Boolean).join(' - ') || 'Servidor',
                            rodape_hash: originalHash,
                            qr_code_url: "".concat(process.env.APP_URL, "/verify/").concat(originalHash),
                            logo_base64: creatorLogoBase64, // Logo do criador, com fallback para logo padrão no pdfService
                            cabecalho_livre: (_d = document.metadata) === null || _d === void 0 ? void 0 : _d.customHeader,
                            data_hora_criacao: now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                            historico: historico.map(function (h) { return ({
                                date: new Date(h.date).toLocaleString('pt-BR'),
                                action: h.action,
                                action_label: formatActionLabel(h.action),
                                user: h.user,
                                role: h.role,
                                details: h.details ? JSON.stringify(h.details) : ''
                            }); }),
                            assinaturas: [],
                            authorHasDigitalSignature: false
                        };
                        return [4 /*yield*/, pdf_service_1.pdfService.generate(pdfData)
                            // 4. Assina Digitalmente (PAdES com certificado do sistema)
                        ];
                    case 6:
                        pdfBuffer = _e.sent();
                        finalPdf = pdfBuffer;
                        _e.label = 7;
                    case 7:
                        _e.trys.push([7, 10, , 11]);
                        certPath = node_path_1.default.resolve(process.cwd(), 'certs', 'certificado_sistema.pfx');
                        if (!node_fs_1.default.existsSync(certPath)) return [3 /*break*/, 9];
                        pfxBuffer = node_fs_1.default.readFileSync(certPath);
                        return [4 /*yield*/, signature_service_1.signatureService.signPdf(pdfBuffer, pfxBuffer, process.env.CERT_PASSWORD || '1234')];
                    case 8:
                        finalPdf = _e.sent();
                        _e.label = 9;
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        e_1 = _e.sent();
                        console.error('Erro ao assinar digitalmente:', e_1);
                        return [3 /*break*/, 11];
                    case 11:
                        uploadDir = node_path_1.default.resolve(process.cwd(), 'uploads');
                        if (!node_fs_1.default.existsSync(uploadDir))
                            node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
                        docTypeAbbrev = {
                            OFICIO: 'OFICIO', MEMORANDO: 'MEMO', OFICIO_CIRCULAR: 'CIRC', DECRETO: 'DEC',
                            PORTARIA: 'PORT', REQUERIMENTO: 'REQ'
                        };
                        filePrefix = docTypeAbbrev[document.documentType] || 'DOC';
                        fileName = "".concat(filePrefix, "_").concat(protocolNumber.replace(/\./g, ''), ".pdf");
                        filePath = node_path_1.default.join(uploadDir, fileName);
                        node_fs_1.default.writeFileSync(filePath, finalPdf);
                        // Atualiza anexo
                        return [4 /*yield*/, prisma_1.prisma.communicationDocument.update({
                                where: { id: documentId },
                                data: {
                                    attachments: {
                                        create: {
                                            fileName: fileName,
                                            fileUrl: "/uploads/".concat(fileName),
                                            fileType: 'application/pdf',
                                            fileSize: finalPdf.length
                                        }
                                    }
                                }
                            })];
                    case 12:
                        // Atualiza anexo
                        _e.sent();
                        return [2 /*return*/, { protocol: protocolNumber, hash: originalHash }];
                }
            });
        });
    };
    /**
     * Registra a assinatura de um usuário e regenera o PDF com o novo status
     */
    DocumentService.prototype.sign = function (documentId, userId, ipAddress) {
        return __awaiter(this, void 0, void 0, function () {
            var document, isCreator, recipient, canSignAsCreator, canSignAsRecipient, alreadySigned, now, signatureHash, historico, signatures, visualSignatures, recipientUser, creatorMeta2, creatorLogoBase64_2, docTypeLabel2, typeLabel2, docRef2, pdfData, pdfBuffer, finalPdf, certPath, pfxBuffer, e_2, fileName, uploadDir, filePath, attachment;
            var _a, _b, _c, _d, _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, prisma_1.prisma.communicationDocument.findUnique({
                            where: { id: documentId },
                            include: {
                                creator: { include: { department: true } },
                                recipients: { include: { user: true } },
                                signatures: true,
                                attachments: true
                            }
                        })];
                    case 1:
                        document = _g.sent();
                        if (!document)
                            throw new Error('Documento não encontrado');
                        isCreator = document.createdBy === userId;
                        recipient = document.recipients.find(function (r) { return r.userId === userId; });
                        canSignAsCreator = isCreator;
                        canSignAsRecipient = recipient && recipient.canSign;
                        if (!canSignAsCreator && !canSignAsRecipient) {
                            // Detalha o erro para debug
                            if (recipient && !recipient.canSign) {
                                throw new Error('Você está na lista de destinatários, mas não foi marcado para assinar este documento.');
                            }
                            throw new Error('Usuário não autorizado a assinar este documento. Apenas o criador ou signatários designados podem realizar esta ação.');
                        }
                        alreadySigned = document.signatures.some(function (s) { return s.userId === userId && s.isValid; });
                        if (alreadySigned)
                            throw new Error('Documento já assinado por este usuário');
                        now = new Date();
                        signatureHash = node_crypto_1.default.createHash('sha256').update("".concat(documentId, "|").concat(userId, "|").concat(now.toISOString())).digest('hex').substring(0, 16).toUpperCase();
                        // 1. Registra Assinatura
                        return [4 /*yield*/, prisma_1.prisma.documentSignature.create({
                                data: {
                                    documentId: documentId,
                                    userId: userId,
                                    signatureType: 'DIGITAL',
                                    ipAddress: ipAddress,
                                    isValid: true,
                                    signedAt: now,
                                    sealData: { hash: signatureHash }
                                }
                            })];
                    case 2:
                        // 1. Registra Assinatura
                        _g.sent();
                        if (!recipient) return [3 /*break*/, 4];
                        return [4 /*yield*/, prisma_1.prisma.documentRecipient.update({
                                where: { id: recipient.id },
                                data: { signedAt: now }
                            })];
                    case 3:
                        _g.sent();
                        _g.label = 4;
                    case 4: 
                    // 2. Log de Auditoria
                    return [4 /*yield*/, audit_service_1.AuditService.log({
                            userId: userId,
                            action: 'SIGNED',
                            resource: 'DOCUMENT',
                            resourceId: documentId,
                            metadata: { signatureHash: signatureHash }
                        })
                        // 3. Regenera o PDF
                    ];
                    case 5:
                        // 2. Log de Auditoria
                        _g.sent();
                        return [4 /*yield*/, audit_service_1.AuditService.getDocumentHistory(documentId)];
                    case 6:
                        historico = _g.sent();
                        return [4 /*yield*/, prisma_1.prisma.documentSignature.findMany({
                                where: { documentId: documentId, isValid: true },
                                include: { user: true }
                            })];
                    case 7:
                        signatures = _g.sent();
                        visualSignatures = signatures.map(function (s) {
                            var _a;
                            return ({
                                nome: "".concat(s.user.firstName, " ").concat(s.user.lastName),
                                cargo: s.user.jobTitle || "Assinante",
                                data: s.signedAt,
                                hash: ((_a = s.sealData) === null || _a === void 0 ? void 0 : _a.hash) || "---",
                                is_digital: true,
                                isAuthor: s.userId === document.createdBy
                            });
                        });
                        recipientUser = (_a = document.recipients[0]) === null || _a === void 0 ? void 0 : _a.user;
                        creatorMeta2 = (_b = document.creator) === null || _b === void 0 ? void 0 : _b.metadata;
                        creatorLogoBase64_2 = (0, pdf_utils_1.loadLogoFromPath)(creatorMeta2 === null || creatorMeta2 === void 0 ? void 0 : creatorMeta2.logoUrl);
                        docTypeLabel2 = {
                            OFICIO: 'OFÍCIO', MEMORANDO: 'MEMORANDO', OFICIO_CIRCULAR: 'OFÍCIO CIRCULAR',
                            DECRETO: 'DECRETO', PORTARIA: 'PORTARIA', REQUERIMENTO: 'REQUERIMENTO'
                        };
                        typeLabel2 = docTypeLabel2[document.documentType] || document.documentType;
                        docRef2 = document.documentNumber || document.protocolNumber || '---';
                        pdfData = {
                            numero_oficio: "".concat(typeLabel2, " N\u00BA ").concat(docRef2),
                            data_extenso: (document.sentAt || now).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
                            nome_destinatario: recipientUser ? "".concat(recipientUser.firstName, " ").concat(recipientUser.lastName) : "A QUEM INTERESSAR POSSA",
                            cargo_destinatario: (recipientUser === null || recipientUser === void 0 ? void 0 : recipientUser.jobTitle) || "Cargo não informado",
                            assunto: document.title,
                            lista_paragrafos: [{ texto: document.content }],
                            nome_remetente: "".concat(document.creator.firstName, " ").concat(document.creator.lastName),
                            cargo_remetente: [
                                document.creator.jobTitle,
                                (_c = document.creator.department) === null || _c === void 0 ? void 0 : _c.name
                            ].filter(Boolean).join(' - ') || 'Servidor',
                            rodape_hash: document.originalHash || "---",
                            qr_code_url: "".concat(process.env.APP_URL, "/verify/").concat(document.originalHash),
                            logo_base64: creatorLogoBase64_2, // Logo do criador, com fallback para logo padrão no pdfService
                            cabecalho_livre: (_d = document.metadata) === null || _d === void 0 ? void 0 : _d.customHeader,
                            historico: historico.map(function (h) { return ({
                                date: new Date(h.date).toLocaleString('pt-BR'),
                                action: h.action,
                                action_label: formatActionLabel(h.action),
                                user: h.user,
                                role: h.role,
                                details: h.details ? JSON.stringify(h.details) : ''
                            }); }),
                            data_hora_criacao: (document.sentAt || now).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                            assinaturas: visualSignatures.map(function (s) { return (__assign(__assign({}, s), { data: new Date(s.data).toLocaleString('pt-BR'), cpf_mascarado: "***.***.***-**", ip: "IP Registrado" // Placeholder ou pegar de log
                             })); }),
                            authorHasDigitalSignature: visualSignatures.some(function (s) { return s.isAuthor; })
                        };
                        return [4 /*yield*/, pdf_service_1.pdfService.generate(pdfData)
                            // 4. Assina o novo PDF
                        ];
                    case 8:
                        pdfBuffer = _g.sent();
                        finalPdf = pdfBuffer;
                        _g.label = 9;
                    case 9:
                        _g.trys.push([9, 12, , 13]);
                        certPath = node_path_1.default.resolve(process.cwd(), 'certs', 'certificado_sistema.pfx');
                        if (!node_fs_1.default.existsSync(certPath)) return [3 /*break*/, 11];
                        pfxBuffer = node_fs_1.default.readFileSync(certPath);
                        return [4 /*yield*/, signature_service_1.signatureService.signPdf(pdfBuffer, pfxBuffer, process.env.CERT_PASSWORD || '1234')];
                    case 10:
                        finalPdf = _g.sent();
                        _g.label = 11;
                    case 11: return [3 /*break*/, 13];
                    case 12:
                        e_2 = _g.sent();
                        console.error('Erro ao assinar PDF regenerado:', e_2);
                        return [3 /*break*/, 13];
                    case 13:
                        fileName = ((_e = document.attachments[0]) === null || _e === void 0 ? void 0 : _e.fileName) || "OFICIO_".concat(((_f = document.protocolNumber) === null || _f === void 0 ? void 0 : _f.replace(/\./g, '')) || 'SIGNED', ".pdf");
                        uploadDir = node_path_1.default.resolve(process.cwd(), 'uploads');
                        if (!node_fs_1.default.existsSync(uploadDir))
                            node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
                        filePath = node_path_1.default.join(uploadDir, fileName);
                        node_fs_1.default.writeFileSync(filePath, finalPdf);
                        return [4 /*yield*/, prisma_1.prisma.communicationAttachment.findFirst({ where: { documentId: documentId } })];
                    case 14:
                        attachment = _g.sent();
                        if (!attachment) return [3 /*break*/, 16];
                        return [4 /*yield*/, prisma_1.prisma.communicationAttachment.update({
                                where: { id: attachment.id },
                                data: { fileSize: finalPdf.length }
                            })];
                    case 15:
                        _g.sent();
                        _g.label = 16;
                    case 16: return [2 /*return*/, { message: 'Assinado com sucesso', signatureHash: signatureHash }];
                }
            });
        });
    };
    return DocumentService;
}());
exports.DocumentService = DocumentService;
function formatActionLabel(action) {
    var map = {
        'CREATED': 'Documento Criado',
        'PROTOCOL_GENERATED': 'Protocolo Gerado',
        'SENT': 'Enviado para Destinatário',
        'READ': 'Visualizado',
        'SIGNED': 'Assinado Digitalmente',
        'DOCUMENT_VIEWED': 'Visualizado pelo Usuário'
    };
    return map[action] || action;
}
exports.documentService = new DocumentService();
