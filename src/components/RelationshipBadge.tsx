import React from 'react';
import { FriendRelationshipStatus } from '../types/friend';

type Props = { status?: FriendRelationshipStatus | null };

const colorMap: Record<string, string> = {
  none: 'bg-gray-200 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800'
};

export default function RelationshipBadge({ status }: Props) {
  const label = !status
    ? 'unknown'
    : status.status === 'pending'
      ? status.direction === 'incoming'
        ? 'request from them'
        : 'request sent'
      : status.status;
  const colorKey = status?.status ?? 'none';
  const cls = `inline-flex items-center rounded px-2 py-1 text-xs font-medium ${colorMap[colorKey] || colorMap.none}`;
  return <span className={cls} title={`relationship: ${label}`}>{label}</span>;
}
