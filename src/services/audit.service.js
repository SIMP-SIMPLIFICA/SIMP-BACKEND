"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditService = exports.AuditService = void 0;
var prisma_1 = require("@/lib/prisma");
var AuditService = /** @class */ (function () {
    function AuditService() {
    }
    /**
     * Registra uma ação no sistema de auditoria imutável
     */
    AuditService.log = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, prisma_1.prisma.auditLog.create({
                                data: {
                                    userId: data.userId,
                                    action: data.action,
                                    resource: data.resource,
                                    resourceId: data.resourceId,
                                    method: data.method,
                                    endpoint: data.endpoint,
                                    ipAddress: data.ipAddress || 'SYSTEM',
                                    userAgent: data.userAgent,
                                    oldData: data.oldData ? JSON.parse(JSON.stringify(data.oldData)) : undefined,
                                    newData: data.newData ? JSON.parse(JSON.stringify(data.newData)) : undefined,
                                    metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
                                    success: (_a = data.success) !== null && _a !== void 0 ? _a : true,
                                    errorMessage: data.errorMessage
                                }
                            })];
                    case 1:
                        _b.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _b.sent();
                        console.error('Falha crítica ao salvar log de auditoria:', error_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Recupera o histórico completo de um documento para a "Última Página"
     */
    AuditService.getDocumentHistory = function (documentId) {
        return __awaiter(this, void 0, void 0, function () {
            var logs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, prisma_1.prisma.auditLog.findMany({
                            where: {
                                resource: 'DOCUMENT',
                                resourceId: documentId,
                                success: true
                            },
                            orderBy: {
                                createdAt: 'asc'
                            },
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        firstName: true,
                                        lastName: true,
                                        username: true,
                                        jobTitle: true
                                    }
                                }
                            }
                        })];
                    case 1:
                        logs = _a.sent();
                        return [2 /*return*/, logs.map(function (log) {
                                var _a;
                                return ({
                                    date: log.createdAt,
                                    action: log.action, // CREATED, SENT, READ, SIGNED
                                    user: log.user ? "".concat(log.user.firstName, " ").concat(log.user.lastName) : 'Sistema',
                                    role: ((_a = log.user) === null || _a === void 0 ? void 0 : _a.jobTitle) || 'N/A',
                                    details: log.metadata
                                });
                            })];
                }
            });
        });
    };
    return AuditService;
}());
exports.AuditService = AuditService;
exports.auditService = new AuditService();
