import React, { memo } from 'react';
import * as d3 from 'd3';
import { TooltipData } from './types';
import { CATEGORY_LABELS } from './constants';

interface SegmentTooltipProps {
  data: TooltipData | null;
  isPinned: boolean;
  onClose?: () => void;
}

// TODO(#445): Add unit tests for section visibility edge cases:
// - Both redeemable/nonRedeemable are zero (hide redemption section)
// - Both vacation/nonVacation are zero (hide type section)
// - All sections hidden (empty breakdown display)
/**
 * Determines if the Redemption section should be shown.
 * Hide if either redeemable or nonRedeemable is zero (making the breakdown redundant).
 */
const shouldShowRedemptionSection = (qualifiers: TooltipData['qualifiers']): boolean => {
  return qualifiers.redeemable !== 0 && qualifiers.nonRedeemable !== 0;
};

/**
 * Determines if the Type section should be shown.
 * Hide if either vacation or nonVacation is zero (making the breakdown redundant).
 */
const shouldShowTypeSection = (qualifiers: TooltipData['qualifiers']): boolean => {
  return qualifiers.vacation !== 0 && qualifiers.nonVacation !== 0;
};

export const SegmentTooltip = memo(function SegmentTooltip({
  data,
  isPinned,
  onClose,
}: SegmentTooltipProps) {
  if (!data) return null;

  const categoryLabel = CATEGORY_LABELS[data.category];

  // Format the date/period - handle both monthly (YYYY-MM) and weekly (YYYY-Www) formats
  let monthFormatted: string;
  const weekMatch = data.month.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) {
    // Weekly format: "2024-W01" - use d3.utcWeek for consistency with chart
    const year = parseInt(weekMatch[1], 10);
    const weekNum = parseInt(weekMatch[2], 10);
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const weekDate = d3.utcWeek.offset(d3.utcYear(yearStart), weekNum);

    monthFormatted = `Week of ${weekDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })}`;
  } else {
    // Monthly format: "YYYY-MM"
    monthFormatted = new Date(data.month + '-01').toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }

  const formatCurrency = (amount: number) => {
    return `$${Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const showRedemption = shouldShowRedemptionSection(data.qualifiers);
  const showType = shouldShowTypeSection(data.qualifiers);

  // Calculate position to keep tooltip on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: `${data.x}px`,
    top: `${data.y}px`,
    zIndex: 1000,
    pointerEvents: isPinned ? 'auto' : 'none',
  };

  // Adjust position if it would go off screen
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const tooltipWidth = 280;
  // Calculate approximate tooltip height for viewport boundary detection
  // Base: 150px (header + total + footer), Section: 100px each (breakdown rows)
  // NOTE: These values are approximations. If tooltip CSS changes significantly,
  // update these constants or consider measuring actual rendered height.
  const sectionCount = Number(showRedemption) + Number(showType);
  const tooltipHeight = 150 + sectionCount * 100;

  if (data.x + tooltipWidth > viewportWidth) {
    style.left = `${viewportWidth - tooltipWidth - 10}px`;
  }
  if (data.y + tooltipHeight > viewportHeight) {
    style.top = `${viewportHeight - tooltipHeight - 10}px`;
  }

  return (
    <div className="segment-tooltip card card-elevated" style={style} role="tooltip">
      <div className="tooltip-header">
        <div>
          <h3 className="tooltip-category">{categoryLabel}</h3>
          <p className="tooltip-month">{monthFormatted}</p>
        </div>
        {isPinned && onClose && (
          <button onClick={onClose} className="tooltip-close" aria-label="Close tooltip">
            ×
          </button>
        )}
      </div>

      <div className="tooltip-total">
        <span className="tooltip-total-label">Total Amount</span>
        <span className="tooltip-total-value">{formatCurrency(data.amount)}</span>
      </div>

      <div className="tooltip-breakdown">
        {showRedemption && (
          <div className="tooltip-section">
            <h4 className="tooltip-section-title">By Redemption</h4>
            <div className="tooltip-row">
              <span className="tooltip-label">Redeemable</span>
              <span className="tooltip-value">{formatCurrency(data.qualifiers.redeemable)}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Non-redeemable</span>
              <span className="tooltip-value">{formatCurrency(data.qualifiers.nonRedeemable)}</span>
            </div>
          </div>
        )}

        {showType && (
          <div className="tooltip-section">
            <h4 className="tooltip-section-title">By Type</h4>
            <div className="tooltip-row">
              <span className="tooltip-label">Vacation</span>
              <span className="tooltip-value">{formatCurrency(data.qualifiers.vacation)}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Non-vacation</span>
              <span className="tooltip-value">{formatCurrency(data.qualifiers.nonVacation)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="tooltip-footer">
        <span className="tooltip-transaction-count">
          {data.qualifiers.transactionCount} transaction
          {data.qualifiers.transactionCount !== 1 ? 's' : ''}
        </span>
        {isPinned && <span className="tooltip-hint">Click outside to unpin</span>}
      </div>
    </div>
  );
});
