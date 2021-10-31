# Configuration Files
The configuration files work in a manner similar to terraform where we will compare the on-chain state for all the contracts to the desired state. If we see a difference between the on-chain state and the desired state we'll send a transaction to update the contract's state to the desired state.

The configuration returns a promise for each contract that has an object shaped like:
```js
 {

   // for a setter that just sets a property
   "setterFunctionName": [
     // first argument in setter
     {
       name: "getterFunctionName",
       value: "desired value",

      /*
       optional: in the case where the getter function returns a struct, this value is the field in the struct that holds the current value
       */
       propertyField: "structField",

      /*
       optional: this allows us to provide a function to transform the value to a format that is more easily understood by humans, like converting wei to eth or converting a uint256 to a percentage
       */
       formatter: (v) => `${makeItPretty(v)}`
     }
   ]

   // for a setter that sets a mapping item
   "setterFunctionName": {
      keyName: {
        mapping: "nameOfMappingProperty",
        value: "the desired value"
        /*
         this is an array of arguments to call the setterFunctionName with. As a convenience, we'll replace {NAME} and {VALUE} with the key name and desired value respectively so that you don't need to reenter these (and introduce bugs by having them be different).
        */
        params: ["{NAME}", "{VALUE}", "some other param"]

       /*
        optional: this allows us to query for the key's value by running the key through a transform first. i.e. keccak256 the key name
        */
        keyTransform: (k) => keccak256(toUtf8Bytes(k.toString())),

        // optional:
        propertyField: "structField",
        // optional:
        formatter: (v) => `${makeItPretty(v)}`
      }
   }
 }
 ``