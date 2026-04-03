import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchPayments, updatePaymentStatus } from "~/api/endpoints";
import type { Payment, PaymentSummary } from "~/types/api";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function PaymentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const t = useT();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [currency, setCurrency] = useState<string>("€");
  const [totalAmount, setTotalAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchPayments(id);
      setPayments(res.payments);
      setSummary(res.summary);
      if (res.currency) setCurrency(res.currency);
      if (res.totalAmount != null) setTotalAmount(res.totalAmount);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (payment: Payment) => {
    if (!id) return;
    const newStatus = payment.status === "paid" ? "pending" : "paid";
    setToggling(payment.id);
    try {
      await updatePaymentStatus(id, payment.playerName, newStatus);
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={payments}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <>
          <Text style={styles.heading}>💰 Payments</Text>
          {summary && (
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{summary.paidCount}</Text>
                <Text style={styles.summaryLabel}>Paid</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: colors.warning }]}>{summary.pendingCount}</Text>
                <Text style={styles.summaryLabel}>Pending</Text>
              </View>
              {totalAmount != null && (
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{currency}{totalAmount}</Text>
                  <Text style={styles.summaryLabel}>Total</Text>
                </View>
              )}
            </View>
          )}
        </>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No payments set up</Text>
          <Text style={styles.emptyDesc}>Enable split costs in event settings to track payments.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => handleToggle(item)}
          disabled={toggling === item.id}
        >
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>{item.playerName}</Text>
            {item.method && (
              <Text style={styles.method}>{item.method}</Text>
            )}
          </View>
          {totalAmount != null && (
            <Text style={styles.amount}>{currency}{item.amount}</Text>
          )}
          <View style={[
            styles.statusBadge,
            item.status === "paid" ? styles.paidBadge : styles.pendingBadge,
          ]}>
            {toggling === item.id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[
                styles.statusText,
                item.status === "paid" ? styles.paidText : styles.pendingText,
              ]}>
                {item.status === "paid" ? "✓ Paid" : "Pending"}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  list: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  heading: {
    color: colors.primary, fontSize: 22, fontWeight: "800",
    marginTop: 16, marginBottom: 12,
  },
  error: { color: colors.error, fontSize: 14 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  summaryCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  summaryLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
    gap: 10,
  },
  playerInfo: { flex: 1 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  method: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  amount: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  statusBadge: {
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    minWidth: 70, alignItems: "center",
  },
  paidBadge: { backgroundColor: colors.primaryDark },
  pendingBadge: { backgroundColor: colors.surfaceHover, borderWidth: 1, borderColor: colors.border },
  statusText: { fontSize: 13, fontWeight: "600" },
  paidText: { color: colors.primaryContainer },
  pendingText: { color: colors.textMuted },
});
