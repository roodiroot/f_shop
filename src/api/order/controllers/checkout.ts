const yooKassa = require("@appigram/yookassa-node")({
  shopId: process.env.YOOKASSA_SHOP_ID,
  secretKey: process.env.YOOKASSA_SECRET_KEY,
});

export default {
  async checkout(ctx) {
    try {
      const { customer, items, paymentMethod } = ctx.request.body;

      if (!customer || !items || !Array.isArray(items) || items.length === 0) {
        return ctx.badRequest("Некорректные данные заказа");
      }

      const userId = ctx.state?.user?.documentId || null;

      const variantIds = items.map((item) => item.variantId);
      const variants = await strapi
        .documents("api::product-variant.product-variant")
        .findMany({
          filters: {
            documentId: { $in: variantIds },
          },
          populate: ["product"],
        });
      if (variants.length === 0) {
        return ctx.badRequest("Варианты товаров не найдены");
      }

      const variantMap = new Map(variants.map((v) => [v.documentId, v]));

      let totalPrice = 0;

      const orderItemsPayload = [];

      for (const cartItem of items) {
        const variant = variantMap.get(cartItem.variantId);
        const quantity = cartItem.quantity;

        if (!variant) {
          return ctx.badRequest(`Вариант ${cartItem.variantId} не найден`);
        }

        const stock = Number(variant.stock || 0);
        const requested = Number(quantity || 0);

        if (stock < requested) {
          return ctx.badRequest(
            `Товаров осталось ${stock}, а в заказе указано ${requested}`
          );
        }

        const price = variant.price;
        const lineTotal = price * cartItem.quantity;

        totalPrice += lineTotal;

        orderItemsPayload.push({
          productVariant: variant.documentId,
          product: variant.product.documentId,
          title: variant.product.shortName,
          sku: variant.product.sku || "",
          price,
          quantity: cartItem.quantity,
          lineTotal,
        });
      }

      const order = await strapi.documents("api::order.order").create({
        data: {
          statusOrder: "pending",
          totalPrice,
          comment: customer.comment ?? "",
          deliveryAddress: customer.deliveryAddress ?? "",
          phone: customer.phone,
          email: customer.email,
          paymentMethod,
          user: userId,
        },
      });

      for (const item of orderItemsPayload) {
        await strapi.documents("api::order-item.order-item").create({
          data: {
            order: order.documentId,
            product: item.product,
            product_variant: item.productVariant,
            title: item.title,
            sku: item.sku,
            price: item.price,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          },
          status: "published",
        });
      }

      const idempotenceKey = `${order.documentId}-${Date.now()}`;

      const payment = await yooKassa.createPayment(
        {
          amount: {
            value: totalPrice.toFixed(2),
            currency: "RUB",
          },
          payment_method_data: {
            type: "bank_card",
          },
          confirmation: {
            type: "redirect",
            return_url: `${process.env.FRONTEND_URL}/order/${order.documentId}/success`,
          },
          capture: true,
          description: `Заказ #${order.documentId}`,
          metadata: {
            orderId: order.documentId,
          },
        },
        idempotenceKey
      );

      await strapi.documents("api::order.order").update({
        documentId: order.documentId,
        data: {
          statusOrder: "waiting_for_payment",
          paymentId: payment.id,
        },
        status: "published",
      });

      ctx.body = {
        orderId: order.documentId,
        totalPrice,
        confirmationUrl: payment.confirmation.confirmation_url,
      };
    } catch (error) {
      console.error("Ошибка checkout:", error);
      return ctx.internalServerError("Ошибка оформления заказа");
    }
  },

  async webhook(ctx) {
    try {
      const body = ctx.request.body;

      const event = body?.event;
      const payment = body?.object;

      if (!payment) {
        strapi.log.warn("YooKassa webhook: нет поля object в теле");
        ctx.body = { ok: false };
        return;
      }

      const orderId = payment.metadata?.orderId;
      if (!orderId) {
        strapi.log.warn("YooKassa webhook: нет metadata.orderId");
        ctx.body = { ok: true };
        return;
      }

      const paymentId = payment.id;

      const order = await strapi.documents("api::order.order").findOne({
        documentId: orderId.toString(),
        populate: {
          order_items: {
            populate: ["product_variant"],
          },
        },
      });

      if (!order) {
        strapi.log.error(`YooKassa webhook: заказ ${orderId} не найден`);
        ctx.body = { ok: true };
        return;
      }

      if (order.statusOrder === "paid") {
        strapi.log.info(
          `YooKassa webhook: заказ ${orderId} уже оплачен, повторный вызов пропускаем`
        );
        ctx.body = { ok: true };
        return;
      }

      if (event === "payment.succeeded") {
        strapi.log.info(
          `YooKassa webhook: оплата успешна для заказа ${orderId}`
        );

        await strapi.documents("api::order.order").update({
          documentId: orderId,
          data: {
            statusOrder: "paid",
            paymentId,
          },
          status: "published",
        });

        for (const item of order.order_items || []) {
          const variantDocId = item.product_variant?.documentId;
          if (!variantDocId) continue;

          const variant = await strapi
            .documents("api::product-variant.product-variant")
            .findOne({
              documentId: variantDocId,
            });

          if (!variant) continue;

          const currentStock = Number(variant.stock || 0);
          const qty = Number(item.quantity || 0);

          await strapi
            .documents("api::product-variant.product-variant")
            .update({
              documentId: variantDocId,
              data: {
                stock: Math.max(currentStock - qty, 0),
              },
              status: "published",
            });
        }
      } else if (event === "payment.canceled") {
        strapi.log.info(
          `YooKassa webhook: оплата ОТМЕНЕНА для заказа ${orderId}`
        );

        await strapi.documents("api::order.order").update({
          documentId: orderId,
          data: {
            statusOrder: "canceled",
            paymentId,
          },
          status: "published",
        });
      } else {
        strapi.log.info(`YooKassa webhook: необработанное событие ${event}`);
      }

      ctx.body = { ok: true };
    } catch (error) {
      strapi.log.error("YooKassa webhook error", error);
      ctx.status = 500;
      ctx.body = { ok: false };
    }
  },
};
