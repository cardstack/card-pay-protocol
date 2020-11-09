import { createStyles, makeStyles } from '@material-ui/core/styles'
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import OwnerForm from './screens/OwnerForm'
import ReviewReplaceOwner from './screens/Review'

import Modal from 'src/components/Modal'
import { addOrUpdateAddressBookEntry } from 'src/logic/addressBook/store/actions/addOrUpdateAddressBookEntry'
import { SENTINEL_ADDRESS, getGnosisSafeInstanceAt } from 'src/logic/contracts/safeContracts'
import { TX_NOTIFICATION_TYPES } from 'src/logic/safe/transactions'
import createTransaction from 'src/logic/safe/store/actions/createTransaction'
import replaceSafeOwner from 'src/logic/safe/store/actions/replaceSafeOwner'
import {
  safeParamAddressFromStateSelector,
  safeThresholdSelector,
  safeModulesSelector,
} from 'src/logic/safe/store/selectors'
import { checksumAddress } from 'src/utils/checksumAddress'
import { makeAddressBookEntry } from 'src/logic/addressBook/model/addressBook'
import { sameAddress } from 'src/logic/wallets/ethAddresses'
import { Dispatch } from 'src/logic/safe/store/actions/types'

const styles = createStyles({
  biggerModalWindow: {
    width: '775px',
    minHeight: '500px',
    height: 'auto',
  },
})

const useStyles = makeStyles(styles)

type OwnerValues = {
  ownerAddress: string
  ownerName: string
  threshold: string
}

type ReplaceOwnerProps = {
  isOpen: boolean
  onClose: () => void
  ownerAddress: string
  ownerName: string
}

const ReplaceOwner = ({ isOpen, onClose, ownerAddress, ownerName }: ReplaceOwnerProps): React.ReactElement => {
  const classes = useStyles()
  const [activeScreen, setActiveScreen] = useState('checkOwner')
  const [values, setValues] = useState<any>({})
  const dispatch = useDispatch()
  const safeAddress = useSelector(safeParamAddressFromStateSelector)
  const modules = useSelector(safeModulesSelector)?.[0] || [safeAddress]

  useEffect(
    () => () => {
      setActiveScreen('checkOwner')
      setValues({})
    },
    [isOpen],
  )

  const onClickBack = () => setActiveScreen('checkOwner')

  const ownerSubmitted = (newValues) => {
    const { ownerAddress, ownerName } = newValues
    const checksumAddr = checksumAddress(ownerAddress)
    values.ownerName = ownerName
    values.ownerAddress = checksumAddr
    setValues(values)
    setActiveScreen('reviewReplaceOwner')
  }

  const onReplaceOwner = async () => {
    onClose()
    try {
      await dispatch(
        createTransaction({
          safeAddress: modules[0] || '0x',
          to: values.ownerAddress,
          valueInWei: '0',
          notifiedTransaction: TX_NOTIFICATION_TYPES.REPLACE_OWNER,
        }),
      )

      dispatch(
        replaceSafeOwner({
          safeAddress,
          oldOwnerAddress: ownerAddress,
          ownerAddress: values.ownerAddress,
          ownerName: values.ownerName,
        }),
      )

      dispatch(
        addOrUpdateAddressBookEntry(makeAddressBookEntry({ address: values.ownerAddress, name: values.ownerName })),
      )
    } catch (error) {
      console.error('Error while removing an owner', error)
    }
  }

  return (
    <Modal
      description="Replace owner from Safe"
      handleClose={onClose}
      open={isOpen}
      paperClassName={classes.biggerModalWindow}
      title="Replace owner from Safe"
    >
      <>
        {activeScreen === 'checkOwner' && (
          <OwnerForm onClose={onClose} onSubmit={ownerSubmitted} ownerAddress={ownerAddress} ownerName={ownerName} />
        )}
        {activeScreen === 'reviewReplaceOwner' && (
          <ReviewReplaceOwner
            onClickBack={onClickBack}
            onClose={onClose}
            onSubmit={onReplaceOwner}
            ownerAddress={ownerAddress}
            ownerName={ownerName}
            values={values}
          />
        )}
      </>
    </Modal>
  )
}

export default ReplaceOwner
