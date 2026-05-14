export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  status: "pending" | "completed" | "failed";
}

export class PaymentService {
  private payments: Map<string, Payment> = new Map();

  processPayment(orderId: string, amount: number): Payment {
    const payment: Payment = {
      id: crypto.randomUUID(),
      orderId,
      amount,
      status: "completed",
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  getPayment(id: string): Payment | null {
    return this.payments.get(id) ?? null;
  }

  refundPayment(id: string): Payment {
    const payment = this.payments.get(id);
    if (!payment) {
      throw new Error(`Payment ${id} not found`);
    }
    payment.status = "failed";
    return payment;
  }
}
