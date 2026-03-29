
function formatActionLabel(action: string): string {
    const map: Record<string, string> = {
        'CREATED': 'Documento Criado',
        'PROTOCOL_GENERATED': 'Protocolo Gerado',
        'SENT': 'Enviado para Destinatário',
        'READ': 'Visualizado',
        'SIGNED': 'Assinado Digitalmente',
        'DOCUMENT_VIEWED': 'Visualizado pelo Usuário'
    };
    return map[action] || action;
}
