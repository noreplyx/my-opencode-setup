import { UserService } from "./user-service";

export interface Order {
  id: string;
  userId: string;
  product: string;
  quantity: number;
  total: number;
  status: "pending" | "shipped" | "delivered";
}

interface OrderInput {
  userId: string;
  product: string;
  quantity: number;
  price: number;
}

export class OrderService {
  private orders: Map<string, Order> = new Map();
  private userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  placeOrder(input: OrderInput): Order {
    if (!input.userId || !input.product || input.quantity <= 0 || input.price <= 0) {
      throw new Error("Invalid order input");
    }

    const order: Order = {
      id: crypto.randomUUID(),
      userId: input.userId,
      product: input.product,
      quantity: input.quantity,
      total: input.quantity * input.price,
      status: "pending",
    };
    this.orders.set(order.id, order);
    return order;
  }

  getOrder(id: string): Order | null {
    return this.orders.get(id) ?? null;
  }

  shipOrder(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error("Order not found");
    order.status = "shipped";
    return order;
  }
}

export function calculateDiscount(total: number, discountPercent: number): number {
  return total * (discountPercent / 100);
}
