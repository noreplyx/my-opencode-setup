export class InventoryService {
  private stock: Map<string, number> = new Map();

  addStock(itemId: string, quantity: number): void {
    const current = this.stock.get(itemId) ?? 0;
    this.stock.set(itemId, current + quantity);
  }

  removeStock(itemId: string, quantity: number): void {
    const current = this.stock.get(itemId) ?? 0;
    if (current < quantity) {
      throw new Error("Insufficient stock");
    }
    this.stock.set(itemId, current - quantity);
  }

  getStock(itemId: string): number {
    return this.stock.get(itemId) ?? 0;
  }
}
