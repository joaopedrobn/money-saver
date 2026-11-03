import { useState, type ComponentProps } from 'react'
import { MovementForm } from './MovementForm'
import { PurchaseForm } from '@/features/cards/PurchaseForm'
export function NewMovementForm(props: ComponentProps<typeof MovementForm>) {
  const [mode, setMode] = useState('bank')
  if (props.movement || props.planned) return <MovementForm {...props} />
  return (
    <>
      <label className="launch-mode">
        Forma de lançamento
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="bank">Conta bancária / Pix</option>
          <option value="credit">Cartão de crédito</option>
        </select>
      </label>
      {mode === 'bank' ? (
        <MovementForm {...props} />
      ) : (
        <PurchaseForm data={props.data} onDone={props.onDone} />
      )}
    </>
  )
}
