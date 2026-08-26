import { CLIENT_EMAIL_FORBIDDEN } from '../../../contracts/email-domain';

export type TemplateVars = Record<string, string | number | boolean | undefined | null>;

export function interpolate(html: string, vars: TemplateVars): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function wrapEmail(inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#1a1a1a;padding:16px;background:#f6f6f6}
.card{max-width:640px;background:#fff;padding:24px;border-radius:8px}
a.btn{display:inline-block;background:#1a1a1a;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px}
.muted{color:#555;font-size:14px} table{width:100%;border-collapse:collapse} td{padding:6px 0;vertical-align:top}</style>
</head><body><div class="card">${inner}</div></body></html>`;
}

export function assertNoInternalCosts(html: string): void {
  const blob = html.toLowerCase();
  for (const key of CLIENT_EMAIL_FORBIDDEN) {
    if (blob.includes(key.toLowerCase())) {
      throw new Error(`SENSITIVE_IN_EMAIL:${key}`);
    }
  }
  if (/"margin"\s*:/.test(html) || /internalCost/.test(html)) {
    throw new Error('SENSITIVE_IN_EMAIL:margin');
  }
}

export const TEMPLATES = {
  verify(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>Hola {{customerName}},</p>
<p>{{intro}}</p>
<p><a class="btn" href="{{verifyUrl}}">{{cta}}</a></p>
<p class="muted">{{expiry}}</p>
<p class="muted">Token: {{verificationToken}}</p>`,
      {
        intro: 'Hacé clic en el botón para verificar tu email y comenzar a usar {{tenantName}}.',
        cta: 'Verificar email',
        expiry: 'El enlace expira en 24 horas.',
        ...vars,
      }
    ));
  },
  orderToWorkshop(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<h2>Nuevo pedido {{orderNumber}}</h2>
<table>
<tr><td>Fecha</td><td>{{date}}</td></tr>
<tr><td>Cliente</td><td>{{customerName}} — {{customerEmail}}{{customerPhone}}</td></tr>
<tr><td>Tipo</td><td>{{customerType}}</td></tr>
<tr><td>Proyecto</td><td>{{projectName}}</td></tr>
<tr><td>Producto / rubro</td><td>{{productName}} / {{rubro}}</td></tr>
<tr><td>Cantidad</td><td>{{quantity}}</td></tr>
<tr><td>Consumo</td><td>{{consumption}}</td></tr>
<tr><td>Material</td><td>{{material}}</td></tr>
<tr><td>Total (cliente)</td><td>{{totalPrice}}</td></tr>
<tr><td>Pago requerido</td><td>{{amountDue}}</td></tr>
<tr><td>Abonado</td><td>{{amountPaid}}</td></tr>
<tr><td>Pendiente</td><td>{{amountRemaining}}</td></tr>
<tr><td>Pago</td><td>{{paymentStatus}}</td></tr>
<tr><td>Comprobante</td><td>{{hasVoucher}}</td></tr>
<tr><td>Observaciones</td><td>{{notes}}</td></tr>
</table>
<p><strong>Archivos</strong></p>
<p>Archivos: {{fileNames}}</p>
<div>{{filesHtml}}</div>
<p><a class="btn" href="{{workshopUrl}}">Ver pedido en el taller</a></p>`,
      vars
    ));
  },
  orderToCustomer(vars: TemplateVars) {
    const html = wrapEmail(interpolate(
      `<p>Hola {{customerName}},</p>
<p>Tu pedido fue recibido correctamente.</p>
<table>
<tr><td>Pedido</td><td>{{orderNumber}}</td></tr>
<tr><td>Producto</td><td>{{productName}}</td></tr>
<tr><td>Cantidad</td><td>{{quantity}}</td></tr>
<tr><td>Consumo</td><td>{{consumption}}</td></tr>
<tr><td>Precio total</td><td>{{totalPrice}}</td></tr>
<tr><td>Pago</td><td>{{paymentStatus}} — {{paymentHint}}</td></tr>
</table>
<p><a class="btn" href="{{trackingUrl}}">Seguir el pedido</a></p>`,
      vars
    ));
    assertNoInternalCosts(html);
    return html;
  },
  paymentConfirmed(vars: TemplateVars) {
    const html = wrapEmail(interpolate(
      `<p>Confirmamos el pago de tu pedido {{orderNumber}}.</p>
<p>Monto pagado: {{amountPaid}}.</p>
<p>Estado actual: {{status}}. {{dueHint}}</p>
<p>Tu pedido ingresó a producción.</p>
<p><a class="btn" href="{{trackingUrl}}">Seguimiento</a></p>`,
      vars
    ));
    assertNoInternalCosts(html);
    return html;
  },
  artifactRejected(vars: TemplateVars) {
    const html = wrapEmail(interpolate(
      `<p>El taller revisó uno de los archivos de tu pedido {{orderNumber}} y necesita una corrección.</p>
<p>Archivo: {{filename}}</p>
<p>Razón: {{reason}}</p>
<p>Podés subir un archivo corregido desde el portal.</p>
<p><a class="btn" href="{{trackingUrl}}">Ir al pedido</a></p>`,
      vars
    ));
    assertNoInternalCosts(html);
    return html;
  },
  changeRequested(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>{{customerName}} solicitó cambios en el pedido {{orderNumber}}.</p>
<p>{{message}}</p>
<p><a class="btn" href="{{workshopUrl}}">Ver pedido</a></p>`,
      vars
    ));
  },
  orderReady(vars: TemplateVars) {
    const html = wrapEmail(interpolate(
      `<p>{{body}}</p>
<p>Pedido {{orderNumber}} — {{productName}}.</p>
<p>{{pickupInfo}}</p>`,
      { body: 'Tu trabajo está terminado y listo para retirar.', ...vars }
    ));
    assertNoInternalCosts(html);
    return html;
  },
  voucherReceived(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>Comprobante de pago recibido de {{customerName}} para el pedido {{orderNumber}}.</p>
<p><a class="btn" href="{{workshopUrl}}">Confirmar el pago</a></p>`,
      vars
    ));
  },
  deadlineOverdue(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>⚠ Pedido {{orderNumber}} — vencido</p>
<p>Cliente: {{customerName}}</p>
<p>Estado actual: {{status}}</p>
<p>Vencimiento: {{dueDate}}</p>
<p><a class="btn" href="{{workshopUrl}}">Ver pedido</a></p>`,
      vars
    ));
  },
  jobFailed(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>⚠ Fallo en el workflow — pedido {{orderNumber}}</p>
<p>Job: {{jobName}}</p>
<p>Error: {{error}}</p>
<p><a class="btn" href="{{workshopUrl}}">Intervenir</a></p>`,
      vars
    ));
  },
  workflowBlocked(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>⚠ Workflow bloqueado — pedido {{orderNumber}}</p>
<p>Estado: {{status}}</p>
<p><a class="btn" href="{{workshopUrl}}">Ver pedido</a></p>`,
      vars
    ));
  },
  orderAssigned(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>Se te asignó el pedido {{orderNumber}}.</p>
<p>Cliente: {{customerName}}</p>
<p><a class="btn" href="{{workshopUrl}}">Abrir pedido</a></p>`,
      vars
    ));
  },
  orderApproved(vars: TemplateVars) {
    return wrapEmail(interpolate(
      `<p>El cliente aprobó el pedido {{orderNumber}}.</p>
<p><a class="btn" href="{{workshopUrl}}">Ver pedido</a></p>`,
      vars
    ));
  },
  messageReplied(vars: TemplateVars) {
    const html = wrapEmail(interpolate(
      `<p>{{body}}</p>
<p>{{content}}</p>`,
      vars
    ));
    assertNoInternalCosts(html);
    return html;
  },
};
