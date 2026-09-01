import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { calibrationNetOd, RESPONSE_BASIS_INTENSITY } from '../../utils/filmCalibration.js'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)

const CHANNELS = [
  { label: 'R', color: '#bf616a' },
  { label: 'G', color: '#a3be8c' },
  { label: 'B', color: '#5e81ac' }
]

function fitPoints(calibration, channel, samples = 180) {
  const [minimum, maximum] = calibration.doseRangeGy
  return Array.from({ length: samples + 1 }, (_, index) => {
    const doseGy = minimum + (maximum - minimum) * index / samples
    return { x: doseGy, y: calibrationNetOd(doseGy, calibration.fits[channel].params) }
  })
}

function measuredPoints(calibration, channel) {
  const responseKey = calibration.responseBasis === RESPONSE_BASIS_INTENSITY ? 'response' : 'netOd'
  return (calibration.points || [])
    .map((point) => ({ x: Number(point.doseGy), y: Number(point.summary?.[responseKey]?.mean?.[channel]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((left, right) => left.x - right.x)
}

export default function CalibrationFitChart({ calibration, compact = false }) {
  if (!calibration?.fits?.length) return null
  const intensity = calibration.responseBasis === RESPONSE_BASIS_INTENSITY
  const data = {
    datasets: CHANNELS.flatMap((channel, index) => [
      {
        label: `${channel.label} · ajuste`,
        data: fitPoints(calibration, index),
        borderColor: channel.color,
        backgroundColor: channel.color,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: 0,
        showLine: true
      },
      {
        label: `${channel.label} · medida`,
        data: measuredPoints(calibration, index),
        borderColor: channel.color,
        backgroundColor: channel.color,
        pointBorderColor: '#eceff4',
        pointBorderWidth: 1,
        pointRadius: compact ? 3 : 4,
        pointHoverRadius: 6,
        showLine: false
      }
    ])
  }
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: {
        labels: {
          color: '#d8dee9',
          boxWidth: 18,
          usePointStyle: true,
          filter: (item) => item.text.includes('ajuste')
        }
      },
      tooltip: {
        callbacks: {
          title: (items) => items.length ? `${items[0].parsed.x.toFixed(3)} Gy` : '',
          label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(5)}`
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Dosis [Gy]', color: '#9aa6b2' },
        ticks: { color: '#9aa6b2' },
        grid: { color: 'rgba(136, 192, 208, .12)' }
      },
      y: {
        title: { display: true, text: intensity ? 'Intensidad normalizada I/65535' : 'netOD', color: '#9aa6b2' },
        ticks: { color: '#9aa6b2' },
        grid: { color: 'rgba(136, 192, 208, .12)' }
      }
    }
  }

  return (
    <div className={`film-fit-chart-panel${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="film-subsection-title">
          <div><strong>Curvas de calibración RGB</strong><span>Los círculos son las respuestas medidas; las líneas representan el ajuste racional monótono.</span></div>
        </div>
      )}
      <div className="film-fit-chart"><Line data={data} options={options} /></div>
      <div className="film-fit-chart-metrics">
        {CHANNELS.map((channel, index) => (
          <span key={channel.label} style={{ '--film-channel-color': channel.color }}>
            {channel.label}: R² {calibration.fits[index].r2.toFixed(4)}
          </span>
        ))}
      </div>
    </div>
  )
}
